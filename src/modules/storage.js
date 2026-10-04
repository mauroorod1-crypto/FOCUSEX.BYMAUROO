(function(global) {
    const STORAGE_KEY = "focusex_data";
    let activeStorageKey = STORAGE_KEY;
    let configuration = null;
    let storageWritable = true;
    let storageFailureNotified = false;
    let storageSizeWarningNotified = false;

    function reportFailure(message, error) {
        if (error) {
            console.error(message, error);
        } else {
            console.warn(message);
        }

        if (!storageFailureNotified) {
            storageFailureNotified = true;
            alert(`${message} Los cambios no se guardarán en este navegador.`);
        }
    }

    function getStorageFailureMessage(operation, error) {
        const isUnavailable = error?.name === "SecurityError" ||
            error?.name === "NotAllowedError" ||
            error?.name === "InvalidStateError";
        if (isUnavailable) {
            return `El almacenamiento del navegador no está disponible; no se pudieron ${operation} los datos.`;
        }
        return `No se pudieron ${operation} los datos de localStorage.`;
    }

    function configure(options) {
        if (!options ||
            !options.defaultData ||
            typeof options.normalizeHabit !== "function" ||
            typeof options.normalizeTask !== "function" ||
            typeof options.migrateTaskHistory !== "function" ||
            typeof options.validateHabit !== "function" ||
            typeof options.validateTask !== "function") {
            throw new TypeError("Configuración de almacenamiento inválida.");
        }

        configuration = options;
    }

    function setUserId(userId) {
        if (userId !== null && (typeof userId !== "string" || !userId)) {
            throw new TypeError("El ID de usuario para el almacenamiento no es válido.");
        }

        const nextKey = userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
        if (userId) {
            try {
                if (localStorage.getItem(nextKey) === null) {
                    const legacyData = localStorage.getItem(STORAGE_KEY);
                    if (legacyData !== null) {
                        const parsedLegacyData = JSON.parse(legacyData);
                        if (Array.isArray(parsedLegacyData.habits) &&
                            Array.isArray(parsedLegacyData.tasks)) {
                            localStorage.setItem(nextKey, legacyData);
                            localStorage.removeItem(STORAGE_KEY);
                        } else {
                            console.warn("Los datos locales antiguos no se migraron porque su estructura no es válida.");
                        }
                    }
                }
            } catch (error) {
                console.warn("No se pudieron migrar los datos locales antiguos:", error);
            }
        }

        activeStorageKey = nextKey;
    }

    function createDefaultData() {
        const initialData = structuredClone(configuration.defaultData);
        initialData.habits = initialData.habits.map(configuration.normalizeHabit);
        initialData.tasks = initialData.tasks.map(configuration.normalizeTask);
        return initialData;
    }

    function load() {
        if (!configuration) {
            throw new Error("StorageModule debe configurarse antes de cargar datos.");
        }

        try {
            const saved = localStorage.getItem(activeStorageKey);
            if (!saved) return createDefaultData();

            const parsed = JSON.parse(saved);
            const isRecord = value =>
                value !== null && typeof value === "object" && !Array.isArray(value);

            if (!isRecord(parsed) ||
                !Array.isArray(parsed.habits) ||
                !Array.isArray(parsed.tasks) ||
                !parsed.habits.every(isRecord) ||
                !parsed.tasks.every(isRecord)) {
                storageWritable = false;
                reportFailure(
                    "Los datos guardados no tienen una estructura válida. Se conservarán sin cambios."
                );
                return createDefaultData();
            }

            const defaults = configuration.defaultData;
            return {
                ...defaults,
                ...parsed,
                habits: parsed.habits.map(configuration.normalizeHabit),
                tasks: parsed.tasks.map(configuration.normalizeTask),
                history: isRecord(parsed.history) ? parsed.history : {},
                taskHistory: configuration.migrateTaskHistory(parsed.taskHistory, parsed.tasks),
                totalXP: Number.isFinite(Number(parsed.totalXP)) && Number(parsed.totalXP) >= 0
                    ? Number(parsed.totalXP)
                    : defaults.totalXP,
                streak: Number.isFinite(Number(parsed.streak)) && Number(parsed.streak) >= 0
                    ? Number(parsed.streak)
                    : defaults.streak,
                bestStreak: Number.isFinite(Number(parsed.bestStreak)) && Number(parsed.bestStreak) >= 0
                    ? Number(parsed.bestStreak)
                    : defaults.bestStreak,
                achievements: isRecord(parsed.achievements)
                    ? parsed.achievements
                    : defaults.achievements
            };
        } catch (error) {
            storageWritable = false;
            reportFailure(
                `${getStorageFailureMessage("cargar", error)} Se conservarán sin cambios.`,
                error
            );
            return createDefaultData();
        }
    }

    function save(dataToSave) {
        if (!storageWritable) return false;

        try {
            if (!dataToSave ||
                !Array.isArray(dataToSave.habits) ||
                !Array.isArray(dataToSave.tasks) ||
                !dataToSave.habits.every(configuration.validateHabit) ||
                !dataToSave.tasks.every(configuration.validateTask)) {
                reportFailure("Los datos contienen hábitos o tareas no válidos; no se guardaron.");
                return false;
            }

            const json = JSON.stringify(dataToSave);
            if (typeof json !== "string") {
                reportFailure("No se pudieron serializar los datos para guardarlos.");
                return false;
            }

            if (json.length > 5_000_000) {
                if (!storageSizeWarningNotified) {
                    storageSizeWarningNotified = true;
                    console.warn("Los datos guardados ocupan demasiado espacio.");
                    alert("Datos muy grandes. Considera limpiar el historial antiguo.");
                }
                return false;
            }

            localStorage.setItem(activeStorageKey, json);
            console.log(`Data saved successfully (${json.length} bytes)`);
            return true;
        } catch (error) {
            storageWritable = false;
            const isQuotaError = error?.name === "QuotaExceededError" ||
                error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
                error?.code === 22 ||
                error?.code === 1014;
            reportFailure(
                isQuotaError
                    ? "Almacenamiento lleno. Limpia datos antiguos."
                    : getStorageFailureMessage("guardar", error),
                error
            );
            return false;
        }
    }

    function clear() {
        try {
            localStorage.removeItem(activeStorageKey);
            storageWritable = true;
            storageFailureNotified = false;
            storageSizeWarningNotified = false;
            return true;
        } catch (error) {
            reportFailure("Error al limpiar los datos de localStorage.", error);
            return false;
        }
    }

    global.StorageModule = Object.freeze({ configure, setUserId, load, save, clear });
})(globalThis);
