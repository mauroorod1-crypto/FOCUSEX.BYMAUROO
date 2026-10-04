/* =========================================================
   FOCUSEX
   Focus. Progress. Become.
   ========================================================= */


/* ================= DATA ================= */

function isSupabaseEnabled() {
    return typeof SupabaseModule !== "undefined" && SUPABASE_CONFIG.enabled;
}

const Storage = StorageModule;
const Validators = ValidatorsModule;
const TASK_PRIORITY_VALUES = ["low", "medium", "high"];
const TASK_PRIORITY_ORDER = ["high", "medium", "low"];
const ANALYTICS_EMPTY_STATE = "Sin datos";
const reportedAppErrors = new Set();

function handleAppError(functionName, error, userMessage) {
    console.error(`Función ${functionName} falló:`, error);

    if (!reportedAppErrors.has(functionName)) {
        reportedAppErrors.add(functionName);
        try {
            alert(userMessage);
        } catch (alertError) {
            console.error("No se pudo mostrar el aviso de error:", alertError);
        }
    }
}


function runSafely(functionName, action, userMessage, fallback) {
    try {
        return action();
    } catch (error) {
        handleAppError(functionName, error, userMessage);
        if (fallback) {
            try {
                fallback();
            } catch (fallbackError) {
                console.error(`Recuperación de ${functionName} falló:`, fallbackError);
            }
        }
        return undefined;
    }
}

const defaultData = {
    habits: [
        {
            id: crypto.randomUUID(),
            name: "Estudiar 1 hora",
            xp: 100,
            frequency: "daily",
            completions: {}
        },
        {
            id: crypto.randomUUID(),
            name: "Leer 20 páginas",
            xp: 50,
            frequency: "daily",
            completions: {}
        },
        {
            id: crypto.randomUUID(),
            name: "Entrenar",
            xp: 100,
            frequency: "daily",
            completions: {}
        }
    ],

    tasks: [
        {
            id: crypto.randomUUID(),
            name: "Organizar el día",
            xp: 30,
            completed: false,
            completedDate: "",
            priority: "medium",
            dueDate: ""
        },
        {
            id: crypto.randomUUID(),
            name: "Terminar proyecto",
            xp: 100,
            completed: false,
            completedDate: "",
            priority: "medium",
            dueDate: ""
        }
    ],

    history: {},

    taskHistory: {},

    totalXP: 0,

    streak: 0,

    bestStreak: 0,

    achievements: {},

    createdAt: new Date().toISOString()
};


Storage.configure({
    defaultData,
    normalizeHabit,
    normalizeTask,
    migrateTaskHistory,
    validateHabit: Validators.validateHabit,
    validateTask: Validators.validateTask
});

let data = structuredClone(defaultData);
let currentUser = null;
let remoteSyncReady = false;
let isInitializing = true;
let hasOfflineChanges = false;


/* ================= DATE ================= */

function getDateKey(date = new Date()) {

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;

}


function getWeekKey(date = new Date()) {

    const weekDate = new Date(Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    ));

    weekDate.setUTCDate(
        weekDate.getUTCDate() + 4 - (weekDate.getUTCDay() || 7)
    );

    const year = weekDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(
        (((weekDate - yearStart) / 86400000) + 1) / 7
    );

    return `${year}-W${String(week).padStart(2, "0")}`;

}


function normalizeHabit(habit) {

    let completions =
        habit.completions &&
        typeof habit.completions === "object" &&
        !Array.isArray(habit.completions)
            ? { ...habit.completions }
            : {};

    if (habit.completed && completions[getDateKey()] === undefined) {
        completions[getDateKey()] = { xp: Number(habit.xp) || 0, achievedValue: null };
    }

    completions = Object.fromEntries(
        Object.entries(completions)
            .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
            .map(([date, record]) => [
                date,
                typeof record === "number"
                    ? { xp: record, achievedValue: null }
                    : {
                        xp: Number(record?.xp) || 0,
                        achievedValue: record?.achievedValue !== null &&
                            record?.achievedValue !== undefined &&
                            Number.isFinite(Number(record.achievedValue))
                            ? Number(record.achievedValue)
                            : null
                    }
            ])
    );

    const completionDates = Object.keys(completions).sort();

    return {
        ...habit,
        description: typeof habit.description === "string" ? habit.description : "",
        frequency: habit.frequency === "weekly" ? "weekly" : "daily",
        weeklyTarget: habit.frequency === "weekly"
            ? Math.min(7, Math.max(1, Number(habit.weeklyTarget) || 1))
            : 1,
        goal: {
            targetValue: Number(habit.goal?.targetValue ?? habit.goalTarget) > 0
                ? Number(habit.goal?.targetValue ?? habit.goalTarget)
                : null
        },
        completions,
        createdOn: habit.createdOn || completionDates[0] || getDateKey()
    };

}


function normalizeTask(task) {

    const {
        title: legacyTitle,
        completedAt: legacyCompletedAt,
        createdOn: legacyCreatedOn,
        ...taskData
    } = task;
    const xp = Number(task.xp);
    const completionHistory =
        task.completionHistory &&
        typeof task.completionHistory === "object" &&
        !Array.isArray(task.completionHistory)
            ? { ...task.completionHistory }
            : {};
    const storedCompletedDate = task.completedDate || legacyCompletedAt;
    const completedTimestamp = Date.parse(storedCompletedDate);
    const completedDate = task.completed
        ? isValidDateKey(storedCompletedDate)
            ? storedCompletedDate
            : Number.isFinite(completedTimestamp)
                ? getDateKey(new Date(completedTimestamp))
                : getDateKey()
        : "";
    const taskXP = Number.isFinite(xp) && xp >= 0 ? xp : 30;

    if (task.completed && completionHistory[completedDate] === undefined) {
        completionHistory[completedDate] = taskXP;
    }

    const normalizedHistory = Object.fromEntries(
        Object.entries(completionHistory)
            .filter(([date, recordXP]) =>
                isValidDateKey(date) &&
                Number.isFinite(Number(recordXP)) &&
                Number(recordXP) >= 0
            )
            .map(([date, recordXP]) => [date, Number(recordXP)])
    );

    return {
        ...taskData,
        name: typeof task.name === "string"
            ? task.name
            : typeof legacyTitle === "string" ? legacyTitle : "Tarea sin nombre",
        description: typeof task.description === "string" ? task.description : "",
        xp: taskXP,
        completed: Boolean(task.completed),
        priority: TASK_PRIORITY_VALUES.includes(task.priority)
            ? task.priority
            : "medium",
        dueDate: isValidDateKey(task.dueDate) ? task.dueDate : "",
        completedDate,
        completionHistory: normalizedHistory,
        createdAt: typeof task.createdAt === "string" && !Number.isNaN(Date.parse(task.createdAt))
            ? task.createdAt
            : typeof legacyCreatedOn === "string" && !Number.isNaN(Date.parse(legacyCreatedOn))
                ? legacyCreatedOn
                : new Date().toISOString()
    };

}


function isValidDateKey(value) {

    return Validators.validateDate(value);

}


function migrateTaskHistory(savedHistory, savedTasks) {

    const history = {};
    if (savedHistory && typeof savedHistory === "object" && !Array.isArray(savedHistory)) {
        for (const [date, records] of Object.entries(savedHistory)) {
            if (!isValidDateKey(date) || !Array.isArray(records)) continue;

            const normalizedRecords = records.flatMap(record => {
                if (typeof record === "string") {
                    const task = savedTasks.find(item => item.id === record);
                    const xp = Number(task?.completionHistory?.[date] ?? task?.xp ?? 0);
                    return [{ id: record, xp: Number.isFinite(xp) && xp >= 0 ? xp : 0 }];
                }

                if (!record || typeof record.id !== "string") return [];
                const xp = Number(record.xp);
                return [{
                    id: record.id,
                    xp: Number.isFinite(xp) && xp >= 0 ? xp : 0
                }];
            });

            if (normalizedRecords.length) {
                history[date] = normalizedRecords.filter(
                    (record, index, all) =>
                        all.findIndex(candidate => candidate.id === record.id) === index
                );
            }
        }
    }

    for (const task of savedTasks.map(normalizeTask)) {
        for (const [date, xp] of Object.entries(task.completionHistory)) {
            history[date] ||= [];
            const existingRecord = history[date].find(record => record.id === task.id);
            if (existingRecord) {
                existingRecord.xp = xp;
            } else {
                history[date].push({ id: task.id, xp });
            }
        }
    }

    return history;

}


function isTaskCompletedOnDate(task, date = new Date()) {

    return Boolean(
        task.completed &&
        task.completedDate === getDateKey(date)
    );

}


function calculateTaskStreak(fromDate = new Date()) {

    const completedDates = new Set(Object.keys(data.taskHistory || {}));
    const cursor = new Date(fromDate);

    if (!completedDates.has(getDateKey(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
    }

    let streak = 0;
    while (completedDates.has(getDateKey(cursor))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;

}


function getTaskCompletionXP(task, date = task.completedDate) {

    return Number(task.completionHistory?.[date] ?? task.xp) || 0;

}


function updateTaskHistory(task, date, xp) {

    data.taskHistory ||= {};
    data.taskHistory[date] ||= [];
    const existing = data.taskHistory[date].find(record => record.id === task.id);
    if (existing) {
        existing.xp = xp;
    } else {
        data.taskHistory[date].push({ id: task.id, xp });
    }

}


function removeTaskHistoryEntry(taskId, date) {

    const records = data.taskHistory?.[date];
    if (!records) return;

    data.taskHistory[date] = records.filter(record => record.id !== taskId);
    if (!data.taskHistory[date].length) delete data.taskHistory[date];

}


function removeTaskHistory(taskId) {

    for (const date of Object.keys(data.taskHistory || {})) {
        removeTaskHistoryEntry(taskId, date);
    }

}


function getTaskHistoryStats(dates) {

    return dates.reduce((stats, { key }) => {
        for (const record of data.taskHistory?.[key] || []) {
            stats.completed++;
            stats.xp += Number(record.xp) || 0;
        }
        return stats;
    }, { completed: 0, xp: 0 });

}


function isTaskOverdue(task, today = getDateKey()) {

    return Boolean(!task.completed && task.dueDate && task.dueDate < today);

}


function getTotalTaskCompletions() {

    return Object.values(data.taskHistory || {})
        .reduce((sum, records) => sum + records.length, 0);

}


function getTotalTaskXPFromHistory() {

    return Object.values(data.taskHistory || {})
        .flat()
        .reduce((sum, record) => sum + (Number(record.xp) || 0), 0);

}


function getHabitCompletionDates(habit, date = new Date()) {

    const dates = Object.keys(habit.completions || {})
        .filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key));

    return dates;

}


function getHabitPeriodDates(habit, date = new Date()) {

    const dates = Object.keys(habit.completions || {})
        .filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key));

    if (habit.frequency !== "weekly") {
        const today = getDateKey(date);
        return dates.includes(today) ? [today] : [];
    }

    const week = getWeekKey(date);

    return dates.filter(key => {
        const [year, month, day] = key.split("-").map(Number);
        return getWeekKey(new Date(year, month - 1, day)) === week;
    });

}


function isHabitCompleted(habit, date = new Date()) {

    if (habit.frequency === "weekly") {
        return getHabitPeriodDates(habit, date).length >= habit.weeklyTarget;
    }

    return isHabitCompletedOnDate(habit, date);

}


function calculateHabitStreak(habit, fromDate = new Date()) {

    let streak = 0;
    const cursor = new Date(fromDate);

    if (habit.frequency === "weekly") {
        const thisWeekCompleted = getHabitPeriodDates(habit, cursor).length >= habit.weeklyTarget;
        if (!thisWeekCompleted) {
            cursor.setDate(cursor.getDate() - 7);
        }

        for (let week = 0; week < 520; week++) {
            if (getHabitPeriodDates(habit, cursor).length < habit.weeklyTarget) break;
            streak++;
            cursor.setDate(cursor.getDate() - 7);
        }

        return streak;
    }

    if (!isHabitCompletedOnDate(habit, cursor)) {
        cursor.setDate(cursor.getDate() - 1);
    }

    for (let day = 0; day < 3650; day++) {
        if (!isHabitCompletedOnDate(habit, cursor)) break;
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;

}


function calculateHabitCompletionRate(habit, today = new Date()) {

    const created = /^\d{4}-\d{2}-\d{2}$/.test(habit.createdOn)
        ? new Date(`${habit.createdOn}T12:00:00`)
        : new Date(today);

    if (habit.frequency === "weekly") {
        const weekStart = date => {
            const [year, month, day] = getDateKey(date).split("-").map(Number);
            const monday = new Date(Date.UTC(year, month - 1, day));
            monday.setUTCDate(
                monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7)
            );
            return monday;
        };
        const weeks = Math.max(
            1,
            Math.floor((weekStart(today) - weekStart(created)) / 604800000) + 1
        );
        const completionsPerWeek = new Map();
        for (const key of getHabitCompletionDates(habit)) {
            if (key < habit.createdOn || key > getDateKey(today)) continue;

            const [year, month, day] = key.split("-").map(Number);
            const week = getWeekKey(new Date(year, month - 1, day));
            completionsPerWeek.set(week, (completionsPerWeek.get(week) || 0) + 1);
        }
        const completedWeeks = [...completionsPerWeek.values()]
            .filter(count => count >= habit.weeklyTarget).length;

        return Math.round(Math.min(1, completedWeeks / weeks) * 100);
    }

    const totalDays = Math.max(
        1,
        Math.floor((new Date(getDateKey(today)) - new Date(getDateKey(created))) / 86400000) + 1
    );
    const completedDays = getHabitCompletionDates(habit)
        .filter(key => key >= habit.createdOn && key <= getDateKey(today)).length;

    return Math.round(Math.min(1, completedDays / totalDays) * 100);

}


function getHabitHistory(habit, days = 14, endDate = new Date()) {

    return Array.from({ length: days }, (_, index) => {
        const date = new Date(endDate);
        date.setDate(date.getDate() - (days - index - 1));
        const key = getDateKey(date);
        const record = habit.completions[key];

        return {
            date,
            key,
            completed: Boolean(record),
            achievedValue: record?.achievedValue ?? null
        };
    });

}


function getCompletionXP(record) {

    return typeof record === "number"
        ? Number(record) || 0
        : Number(record?.xp) || 0;

}


function isHabitCompletedOnDate(habit, date = new Date()) {

    return Object.prototype.hasOwnProperty.call(
        habit.completions || {},
        getDateKey(date)
    );

}


function formatDate(date = new Date()) {

    return date.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long"
    });

}


/* ================= PROGRESS ================= */

function getProgress() {

    const completedHabits = data.habits.filter(
        habit => isHabitCompletedOnDate(habit)
    ).length;
    const completedTasks = data.tasks.filter(
        task => isTaskCompletedOnDate(task)
    ).length;
    const totalItems = data.habits.length + data.tasks.length;

    if (!totalItems) return 0;

    return Math.round(
        ((completedHabits + completedTasks) / totalItems) * 100
    );

}


/* ================= LEVEL ================= */

function getLevel(xp) {

    return Math.floor(xp / 1000) + 1;

}


/* ================= RANK ================= */

const ranks = [
    {
        name: "NOVICE",
        min: 0,
        next: 500,
        description: "Tu camino acaba de comenzar."
    },
    {
        name: "BRONZE",
        min: 500,
        next: 1500,
        description: "La constancia empieza a formar parte de ti."
    },
    {
        name: "SILVER",
        min: 1500,
        next: 3000,
        description: "Estás construyendo una disciplina real."
    },
    {
        name: "GOLD",
        min: 3000,
        next: 6000,
        description: "Tu progreso comienza a destacar."
    },
    {
        name: "PLATINUM",
        min: 6000,
        next: 10000,
        description: "Tu consistencia está alcanzando otro nivel."
    },
    {
        name: "DIAMOND",
        min: 10000,
        next: 20000,
        description: "Has alcanzado un nivel excepcional."
    },
    {
        name: "MASTER",
        min: 20000,
        next: 35000,
        description: "La disciplina ya forma parte de tu identidad."
    },
    {
        name: "GRANDMASTER",
        min: 35000,
        next: 50000,
        description: "Muy pocos llegan hasta aquí."
    },
    {
        name: "FOCUSEX",
        min: 50000,
        next: 75000,
        description: "Has llevado tu progreso al siguiente nivel."
    }
];


function getRank(xp) {

    let current = ranks[0];

    for (const rank of ranks) {

        if (xp >= rank.min) {
            current = rank;
        }

    }

    return current;

}


/* ================= STREAK ================= */

function calculateStreak() {

    let streak = 0;

    const today = new Date();

    const cursor = new Date(today);
    while (true) {
        const key = getDateKey(cursor);
        if (data.history[key] === undefined || data.history[key] < 50) break;

        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;

}


function calculateBestStreak() {

    const dates = Object.keys(data.history)
        .sort();

    let best = 0;
    let current = 0;
    let previous = null;

    for (const key of dates) {

        const progress = data.history[key];

        if (progress >= 50) {

            if (previous) {

                const previousDate = new Date(`${previous}T12:00:00`);
                previousDate.setDate(previousDate.getDate() + 1);

                if (getDateKey(previousDate) === key) {

                    current++;

                } else {

                    current = 1;

                }

            } else {

                current = 1;

            }

            best = Math.max(best, current);

        } else {

            current = 0;

        }

        previous = key;

    }

    return best;

}


/* ================= HISTORY ================= */

function saveTodayProgress() {

    const key = getDateKey();

    data.history[key] = getProgress();

    data.streak = calculateStreak();

    data.bestStreak = calculateBestStreak();

}


/* ================= NAVIGATION ================= */

const navItems =
    document.querySelectorAll(".nav-item");

function navigateTo(section) {

    if (!document.getElementById(section)) return;

    const pages = document.querySelectorAll(".page");
    pages.forEach(page => {

        page.classList.toggle(
            "active",
            page.id === section
        );

    });

    navItems.forEach(item => {

        item.classList.toggle(
            "active",
            item.dataset.section === section
        );

    });

    const titles = {
        dashboard: "Dashboard",
        habits: "Hábitos",
        tasks: "Tareas",
        agenda: "Agenda",
        analytics: "Analytics",
        achievements: "Logros"
    };

    document.getElementById("pageTitle").textContent =
        titles[section] || "Dashboard";

    renderAll();

}


navItems.forEach(item => {

    item.addEventListener("click", function() {
        const section = this.getAttribute("data-section");
        if (section) navigateTo(section);
    });

});


document.querySelectorAll("[data-section]:not(.nav-item)")
.forEach(button => {

    button.addEventListener("click", () => {

        const section =
            button.dataset.section;

        if (section) {
            navigateTo(section);
        }

    });

});


/* ================= MODAL ================= */

const modalOverlay =
    document.getElementById("modalOverlay");

const modalClose =
    document.getElementById("modalClose");

const modalTitle =
    document.getElementById("modalTitle");

const itemForm =
    document.getElementById("itemForm");

const itemName =
    document.getElementById("itemName");

const itemXP =
    document.getElementById("itemXP");

const habitFrequencyField =
    document.getElementById("habitFrequencyField");

const habitFrequency =
    document.getElementById("habitFrequency");

const habitWeeklyTargetField =
    document.getElementById("habitWeeklyTargetField");

const habitWeeklyTarget =
    document.getElementById("habitWeeklyTarget");

const habitDescriptionField =
    document.getElementById("habitDescriptionField");

const habitDescription =
    document.getElementById("habitDescription");

const habitGoalField =
    document.getElementById("habitGoalField");

const habitGoalTarget =
    document.getElementById("habitGoalTarget");

const itemSubmitText =
    document.getElementById("itemSubmitText");

const taskPriorityField =
    document.getElementById("taskPriorityField");

const taskPriority =
    document.getElementById("taskPriority");

const taskDescriptionField =
    document.getElementById("taskDescriptionField");

const taskDescription =
    document.getElementById("taskDescription");

const taskDueDateField =
    document.getElementById("taskDueDateField");

const taskDueDate =
    document.getElementById("taskDueDate");

let modalType = "habit";
let editingHabitId = null;
let editingTaskId = null;


function openModal(type, item = null) {

    modalType = type;
    editingHabitId = type === "habit" && item ? item.id : null;
    editingTaskId = type === "task" && item ? item.id : null;

    modalTitle.textContent =
        item
            ? "Editar hábito"
            : type === "habit" ? "Nuevo hábito" : "Nueva tarea";
    if (type === "task" && item) {
        modalTitle.textContent = "Editar tarea";
    }

    itemName.value = item ? item.name : "";
    itemXP.value = item
        ? item.xp
        : type === "habit"
            ? 50
            : 30;
    habitFrequency.value = item && type === "habit" ? item.frequency : "daily";
    habitFrequencyField.hidden = type !== "habit";
    habitWeeklyTargetField.hidden =
        type !== "habit" || habitFrequency.value !== "weekly";
    habitDescriptionField.hidden = type !== "habit";
    habitGoalField.hidden = type !== "habit";
    taskDescriptionField.hidden = type !== "task";
    habitWeeklyTarget.value = item && type === "habit" ? item.weeklyTarget : 1;
    habitDescription.value = item && type === "habit" ? item.description : "";
    habitGoalTarget.value =
        item && type === "habit" && item.goal.targetValue
            ? item.goal.targetValue
            : "";
    taskPriorityField.hidden = type !== "task";
    taskDueDateField.hidden = type !== "task";
    taskPriority.value = item && type === "task" ? item.priority : "medium";
    taskDescription.value = item && type === "task" ? item.description : "";
    taskDueDate.value = item && type === "task" ? item.dueDate : "";
    itemSubmitText.textContent = item ? "Guardar cambios" : "Crear";

    modalOverlay.classList.add("active");

    setTimeout(
        () => itemName.focus(),
        100
    );

}


habitFrequency.addEventListener("change", () => {
    habitWeeklyTargetField.hidden = habitFrequency.value !== "weekly";
});


function closeModal() {

    modalOverlay.classList.remove("active");
    editingHabitId = null;
    editingTaskId = null;

}


modalClose.addEventListener(
    "click",
    closeModal
);


modalOverlay.addEventListener(
    "click",
    event => {

        if (event.target === modalOverlay) {
            closeModal();
        }

    }
);


document.getElementById("addHabitBtn")
    .addEventListener(
        "click",
        () => openModal("habit")
    );


document.getElementById("addTaskBtn")
    .addEventListener(
        "click",
        () => openModal("task")
    );


document.getElementById("quickAddBtn")
    .addEventListener(
        "click",
        () => openModal("habit")
    );


itemForm.addEventListener(
    "submit",
    event => {

        event.preventDefault();

        const name =
            itemName.value.trim();

        const xp = Number(itemXP.value);

        itemName.setCustomValidity(name ? "" : "El nombre es obligatorio.");
        itemXP.setCustomValidity(
            Number.isFinite(xp) && xp >= (modalType === "habit" ? 1 : 0)
                ? ""
                : modalType === "habit"
                    ? "El XP del hábito debe ser al menos 1."
                    : "El XP debe ser un número igual o mayor que 0."
        );
        if (!itemForm.reportValidity()) return;

        if (modalType === "habit") {

            const targetValue = habitGoalTarget.value === ""
                ? null
                : Number(habitGoalTarget.value);
            const weeklyTarget = Math.min(
                7,
                Math.max(1, Number(habitWeeklyTarget.value) || 1)
            );

            if (targetValue !== null && (!Number.isFinite(targetValue) || targetValue <= 0)) {
                habitGoalTarget.focus();
                return;
            }

            const habitFields = {
                name,
                description: habitDescription.value.trim(),
                xp,
                frequency: habitFrequency.value,
                weeklyTarget: habitFrequency.value === "weekly" ? weeklyTarget : 1,
                goal: { targetValue }
            };

            let savedHabit;
            if (editingHabitId) {
                savedHabit = editHabit(editingHabitId, habitFields);
            } else {
                savedHabit = createHabit(habitFields);
            }
            if (!savedHabit) return;

        } else {

            const taskFields = {
                name,
                description: taskDescription.value.trim(),
                xp,
                priority: taskPriority.value,
                dueDate: taskDueDate.value
            };

            if (editingTaskId) {
                if (!updateTask(editingTaskId, taskFields)) return;
            } else {
                if (!createTask(taskFields)) return;
            }

        }

        closeModal();

        renderAll();

    }
);


/* ================= TOGGLE ITEM ================= */

function toggleItem(type, id) {
    return runSafely(
        "toggleItem",
        () => toggleItemUnsafe(type, id),
        "No se pudo actualizar la tarea. Inténtalo de nuevo."
    );
}

function toggleItemUnsafe(type, id) {
    if (type === "habit") {
        return completeHabit(id);
    }

    const collection =
        data.tasks;

    const item =
        collection.find(
            element => element.id === id
        );

    if (!item) return false;
    if (!Validators.validateTask(item)) {
        alert("Los datos de la tarea no son válidos y no se puede cambiar su estado.");
        return false;
    }

    /*
       Solo se añade XP cuando el elemento
       pasa de pendiente a completado.
    */

    if (!item.completed) {

        data.totalXP += Number(item.xp);
        item.completedDate = getDateKey();
        item.completionHistory ||= {};
        item.completionHistory[item.completedDate] = Number(item.xp);
        updateTaskHistory(item, item.completedDate, Number(item.xp));

    } else {

        const completionDate = item.completedDate;
        data.totalXP = Math.max(
            0,
            data.totalXP - getTaskCompletionXP(item, completionDate)
        );
        if (completionDate && item.completionHistory) {
            delete item.completionHistory[completionDate];
        }
        removeTaskHistoryEntry(item.id, completionDate);

    }

    item.completed =
        !item.completed;
    if (!item.completed) item.completedDate = "";

    saveTodayProgress();

    renderAll();
    return true;

}


const recentlyCompletedHabits = new Set();
const recentlyEditedHabits = new Set();


function createHabit(fields) {
    return runSafely(
        "createHabit",
        () => createHabitUnsafe(fields),
        "No se pudo crear el hábito. Revisa los datos e inténtalo de nuevo."
    );
}

function createHabitUnsafe(fields) {
    fields = normalizeNamedFields(fields);
    const validationMessage = getHabitValidationMessage(fields);
    if (validationMessage) {
        alert(validationMessage);
        return false;
    }

    const habit = normalizeHabit({
        id: crypto.randomUUID(),
        ...fields,
        createdOn: getDateKey(),
        completions: {}
    });

    if (!Validators.validateHabit(habit)) {
        alert("Los datos del hábito no son válidos.");
        return false;
    }

    data.habits.push(habit);

    return habit;

}


function normalizeNamedFields(fields) {

    return {
        ...fields,
        name: typeof fields?.name === "string" ? fields.name.trim() : fields?.name
    };

}


function getHabitValidationMessage(habit) {

    if (!habit || typeof habit.name !== "string" || !habit.name.trim()) {
        return "El nombre del hábito es obligatorio.";
    }
    if (habit.name.trim().length > 100) {
        return "El nombre del hábito no puede superar los 100 caracteres.";
    }
    if (!Number.isFinite(Number(habit.xp)) || Number(habit.xp) <= 0) {
        return "El XP del hábito debe ser un número positivo.";
    }
    if (!Validators.validateHabit(habit)) {
        return "Los datos del hábito no son válidos.";
    }

    return "";

}


function editHabit(id, fields = null) {
    return runSafely(
        "editHabit",
        () => editHabitUnsafe(id, fields),
        "No se pudo editar el hábito. Inténtalo de nuevo."
    );
}

function editHabitUnsafe(id, fields = null) {
    const habit = data.habits.find(
        item => item.id === id
    );

    if (!habit) {
        alert("No se encontró el hábito que intentas editar.");
        return false;
    }

    if (!fields) {
        openModal("habit", habit);
        return;
    }

    fields = normalizeNamedFields(fields);
    const validationMessage = getHabitValidationMessage(fields);
    if (validationMessage) {
        alert(validationMessage);
        return false;
    }

    for (const date of getHabitPeriodDates(habit)) {
        const record = habit.completions[date];
        data.totalXP += Number(fields.xp) - getCompletionXP(record);
        habit.completions[date] = {
            ...(typeof record === "object" ? record : {}),
            xp: Number(fields.xp),
            achievedValue: typeof record === "object"
                ? record.achievedValue ?? null
                : null
        };
    }

    Object.assign(habit, fields);
    recentlyEditedHabits.add(id);

    return habit;


}


function getTaskValidationMessage(task) {

    if (!task || typeof task.name !== "string" || !task.name.trim()) {
        return "El nombre de la tarea es obligatorio.";
    }
    if (task.name.trim().length > 200) {
        return "El nombre de la tarea no puede superar los 200 caracteres.";
    }
    if (!Number.isFinite(Number(task.xp)) || Number(task.xp) < 0) {
        return "El XP de la tarea debe ser un número igual o mayor que 0.";
    }
    if (!TASK_PRIORITY_VALUES.includes(task.priority)) {
        return "Selecciona una prioridad válida para la tarea.";
    }
    if (task.dueDate && !Validators.validateDate(task.dueDate)) {
        return "La fecha de vencimiento no es válida.";
    }
    if (!Validators.validateTask(task)) {
        return "Los datos de la tarea no son válidos.";
    }

    return "";

}


function createTask(fields) {
    return runSafely(
        "createTask",
        () => createTaskUnsafe(fields),
        "No se pudo crear la tarea. Revisa los datos e inténtalo de nuevo."
    );
}

function createTaskUnsafe(fields) {
    fields = normalizeNamedFields(fields);
    const validationMessage = getTaskValidationMessage(fields);
    if (validationMessage) {
        alert(validationMessage);
        return false;
    }

    if (fields.dueDate && fields.dueDate < getDateKey()) {
        alert("La fecha de vencimiento ya pasó. La tarea se guardará igualmente.");
    }

    const task = {
        id: crypto.randomUUID(),
        completed: false,
        completedDate: "",
        completionHistory: {},
        createdAt: new Date().toISOString(),
        ...fields
    };

    if (!Validators.validateTask(task)) {
        alert("Los datos de la tarea no son válidos.");
        return false;
    }

    data.tasks.push(task);
    return task;

}


function updateTask(id, fields) {
    return runSafely(
        "updateTask",
        () => updateTaskUnsafe(id, fields),
        "No se pudo actualizar la tarea. Inténtalo de nuevo."
    );
}

function updateTaskUnsafe(id, fields) {
    const task = data.tasks.find(item => item.id === id);
    if (!task) {
        alert("No se encontró la tarea que intentas editar.");
        return false;
    }

    fields = normalizeNamedFields(fields);
    const validationMessage = getTaskValidationMessage(fields);
    if (validationMessage) {
        alert(validationMessage);
        return false;
    }
    if (!Validators.validateTask({ ...task, ...fields })) {
        alert("Los datos de la tarea no son válidos.");
        return false;
    }

    if (task.completed) {
        const previousXP = getTaskCompletionXP(task);
        data.totalXP += Number(fields.xp) - previousXP;
        if (task.completedDate) {
            task.completionHistory ||= {};
            task.completionHistory[task.completedDate] = fields.xp;
            updateTaskHistory(task, task.completedDate, fields.xp);
        }
    }

    Object.assign(task, fields);
    return task;

}


function completeHabit(id, achievedValue) {
    return runSafely(
        "completeHabit",
        () => completeHabitUnsafe(id, achievedValue),
        "No se pudo actualizar el hábito. Inténtalo de nuevo."
    );
}

function completeHabitUnsafe(id, achievedValue) {
    const habit = data.habits.find(item => item.id === id);
    if (!habit) return false;
    if (!Validators.validateHabit(habit)) {
        alert("Los datos del hábito no son válidos y no se puede cambiar su estado.");
        return false;
    }

    const today = getDateKey();
    const existingRecord = habit.completions[today];

    if (existingRecord) {
        data.totalXP = Math.max(0, data.totalXP - getCompletionXP(existingRecord));
        delete habit.completions[today];
        recentlyCompletedHabits.delete(id);
    } else {
        const completedThisWeek = getHabitPeriodDates(habit);
        if (
            habit.frequency === "weekly" &&
            completedThisWeek.length >= habit.weeklyTarget
        ) {
            return false;
        }

        const progressInput = document.getElementById(`habitProgress-${id}`);
        const inputValue = achievedValue !== undefined
            ? achievedValue
            : progressInput && progressInput.value !== ""
                ? Number(progressInput.value)
                : null;

        if (inputValue !== null && (!Number.isFinite(Number(inputValue)) || Number(inputValue) < 0)) {
            if (progressInput) progressInput.focus();
            return false;
        }

        habit.completions[today] = {
            xp: Number(habit.xp),
            achievedValue: inputValue === null ? null : Number(inputValue)
        };
        data.totalXP += Number(habit.xp);
        recentlyCompletedHabits.add(id);
    }

    saveTodayProgress();
    renderAll();
    return true;

}


function deleteHabit(id) {

    const index = data.habits.findIndex(item => item.id === id);
    if (index < 0) return false;

    const habit = data.habits[index];
    const earnedXP = Object.values(habit.completions)
        .reduce((sum, record) => sum + getCompletionXP(record), 0);

    data.totalXP = Math.max(0, data.totalXP - earnedXP);
    data.habits.splice(index, 1);
    recentlyCompletedHabits.delete(id);
    recentlyEditedHabits.delete(id);

    return true;

}


/* ================= DELETE ================= */

function deleteItem(type, id) {
    return runSafely(
        "deleteItem",
        () => deleteItemUnsafe(type, id),
        "No se pudo eliminar el elemento. Inténtalo de nuevo."
    );
}

function deleteItemUnsafe(type, id) {
    if (type !== "habit" && type !== "task") return false;

    const item = (type === "habit" ? data.habits : data.tasks)
        .find(element => element.id === id);

    if (!item) return false;

    if (
        !confirm(
            `¿Estás seguro de eliminar ${type === "habit" ? "este hábito" : "esta tarea"}?`
        )
    ) return false;

    if (type === "habit") {

        deleteHabit(id);

    } else {

        if (item.completed) {
            data.totalXP = Math.max(
                0,
                data.totalXP - getTaskCompletionXP(item)
            );
        }

        removeTaskHistory(item.id);
        data.tasks =
            data.tasks.filter(
                item => item.id !== id
            );

    }

    saveTodayProgress();

    renderAll();
    return true;

}


/* ================= RENDER DASHBOARD ================= */

function renderDashboard() {

    const progress =
        getProgress();

    const xp =
        data.totalXP;

    const level =
        getLevel(xp);

    const rank =
        getRank(xp);

    setAnimatedText(
        document.getElementById("todayProgress"),
        `${progress}%`
    );

    document.getElementById(
        "todayProgressBar"
    ).style.width =
        `${progress}%`;

    document.getElementById(
        "currentStreak"
    ).textContent =
        `${data.streak} días`;

    setAnimatedText(
        document.getElementById("totalXP"),
        xp.toLocaleString()
    );

    document.getElementById(
        "currentLevel"
    ).textContent =
        level;

    document.getElementById(
        "currentRank"
    ).textContent =
        rank.name;

    document.getElementById(
        "rankName"
    ).textContent =
        rank.name;

    document.getElementById(
        "rankDescription"
    ).textContent =
        rank.description;

    document.getElementById(
        "rankIcon"
    ).textContent =
        rank.name.charAt(0);

    setAnimatedText(
        document.getElementById("rankXP"),
        `${xp.toLocaleString()} XP`
    );

    document.getElementById(
        "nextRankXP"
    ).textContent =
        `${rank.next.toLocaleString()} XP`;

    const rankRange =
        rank.next - rank.min;

    const rankProgress =
        Math.min(
            100,
            Math.max(
                0,
                ((xp - rank.min) / rankRange) * 100
            )
        );

    document.getElementById(
        "rankProgressBar"
    ).style.width =
        `${rankProgress}%`;

    setAnimatedText(
        document.getElementById("sidebarXP"),
        `${xp.toLocaleString()} XP`
    );

    document.getElementById(
        "sidebarStreak"
    ).textContent =
        `${data.streak} días`;

    renderDashboardHabits();
    renderDashboardTasks();

}


/* ================= DASHBOARD HABITS ================= */

function renderDashboardHabits() {

    const container =
        document.getElementById(
            "dashboardHabits"
        );

    if (!data.habits.length) {

        container.innerHTML =
            `<div class="empty">
                No tienes hábitos todavía.
            </div>`;

        return;

    }

    container.innerHTML =
        data.habits.slice(0, 5)
        .map(item => `

            <div class="list-item">

                <button
                    class="check ${isHabitCompletedOnDate(item) ? "done" : ""}"
                    aria-label="${isHabitCompletedOnDate(item) ? "Desmarcar hábito" : "Marcar hábito como completado"}: ${escapeHTML(item.name)}"
                    onclick="toggleItem('habit','${item.id}')"
                >
                    ${isHabitCompletedOnDate(item) ? "✓" : ""}
                </button>

                <div class="item-content">

                    <strong>
                        ${escapeHTML(item.name)}
                    </strong>

                    <small>
                        Hábito · ${item.frequency === "weekly" ? "Semanal" : "Diario"}
                    </small>

                </div>

                <span class="item-xp">
                    +${item.xp} XP
                </span>

            </div>

        `)
        .join("");

}


/* ================= DASHBOARD TASKS ================= */

function renderDashboardTasks() {

    const container =
        document.getElementById(
            "dashboardTasks"
        );

    const pendingTasks = data.tasks
        .filter(task => !task.completed)
        .sort(comparePendingTasks);
    const completed = data.tasks.filter(task => task.completed).length;
    const earnedTaskXP = getTotalTaskXPFromHistory();

    container.innerHTML = `
        <small class="task-dashboard-summary">
            ${pendingTasks.length} pendientes · ${completed}/${data.tasks.length} completadas · ${earnedTaskXP} XP histórico
        </small>
        ${pendingTasks.length ? pendingTasks.slice(0, 5).map(item => `

            <div class="list-item">

                <button
                    class="check ${item.completed ? "done" : ""}"
                    aria-label="Marcar tarea como completada: ${escapeHTML(item.name)}"
                    onclick="toggleItem('task','${item.id}')"
                >
                    ${item.completed ? "✓" : ""}
                </button>

                <div class="item-content">

                    <strong>
                        ${escapeHTML(item.name)}
                    </strong>

                    <small>
                        Tarea${item.dueDate ? ` · ${escapeHTML(item.dueDate)}` : ""}
                    </small>

                </div>

                <span class="item-xp">
                    +${item.xp} XP
                </span>

            </div>

        `).join("") : `<div class="empty">No tienes tareas pendientes.</div>`}
    `;

}


function setAnimatedText(element, value) {

    const text = String(value);
    if (element.textContent === text) return;

    element.textContent = text;
    element.classList.remove("value-updated");
    void element.offsetWidth;
    element.classList.add("value-updated");

}


/* ================= HABITS ================= */

function renderHabits() {

    const container =
        document.getElementById(
            "habitsList"
        );

    const total =
        data.habits.length;

    const completed = data.habits.filter(
        item => isHabitCompleted(item)
    ).length;

    const consistency =
        total
            ? Math.round(
                completed / total * 100
            )
            : 0;

    document.getElementById(
        "habitTotal"
    ).textContent =
        total;

    document.getElementById(
        "habitCompleted"
    ).textContent =
        completed;

    document.getElementById(
        "habitConsistency"
    ).textContent =
        `${consistency}%`;

    const todayHabits = document.getElementById("habitsTodayList");

    if (!total) {
        container.innerHTML = `<div class="empty">Crea tu primer hábito.</div>`;
        todayHabits.innerHTML = `<div class="empty">No hay hábitos para hoy.</div>`;
        return;
    }

    container.innerHTML = data.habits.map(renderHabitCard).join("");
    todayHabits.innerHTML = data.habits.map(habit => {
        const checked = isHabitCompletedOnDate(habit);
        const thisWeekCount = getHabitPeriodDates(habit).length;
        const frequency = habit.frequency === "weekly"
            ? `Semanal · ${thisWeekCount}/${habit.weeklyTarget} esta semana`
            : "Diario";

        return `
            <div class="list-item habit-today-item ${recentlyCompletedHabits.has(habit.id) ? "habit-xp-earned" : ""}">
                <button class="check ${checked ? "done" : ""}"
                    onclick="completeHabit('${habit.id}')"
                    ${habit.frequency === "weekly" && thisWeekCount >= habit.weeklyTarget && !checked ? "disabled" : ""}
                    aria-label="${checked ? "Desmarcar hábito" : "Completar hábito"}">${checked ? "✓" : ""}</button>
                <div class="item-content">
                    <strong>${escapeHTML(habit.name)}</strong>
                    <small>${escapeHTML(frequency)}</small>
                </div>
                <span class="item-xp">+${habit.xp} XP</span>
            </div>
        `;
    }).join("");

    recentlyCompletedHabits.clear();
    recentlyEditedHabits.clear();

}


function renderHabitCard(habit) {

    const checkedToday = isHabitCompletedOnDate(habit);
    const completionRate = calculateHabitCompletionRate(habit);
    const streak = calculateHabitStreak(habit);
    const thisWeekCount = getHabitPeriodDates(habit).length;
    const history = getHabitHistory(habit);
    const goalTarget = habit.goal.targetValue;
    const todayValue = habit.completions[getDateKey()]?.achievedValue;
    const frequencyText = habit.frequency === "weekly"
        ? `${habit.weeklyTarget} ${habit.weeklyTarget === 1 ? "vez" : "veces"} por semana`
        : "Diario";
    const weeklyLimitReached = habit.frequency === "weekly" &&
        thisWeekCount >= habit.weeklyTarget && !checkedToday;

    return `
        <article class="data-card habit-card ${recentlyEditedHabits.has(habit.id) ? "habit-edited" : ""} ${recentlyCompletedHabits.has(habit.id) ? "habit-xp-earned" : ""}">
            <div class="data-card-top">
                <div class="habit-card-title">
                    <h4>${escapeHTML(habit.name)}</h4>
                    ${habit.description ? `<p>${escapeHTML(habit.description)}</p>` : ""}
                    <p class="habit-meta">+${habit.xp} XP · ${escapeHTML(frequencyText)}</p>
                </div>
                <div class="card-actions">
                    <button class="check ${checkedToday ? "done" : ""}"
                        onclick="completeHabit('${habit.id}')"
                        ${weeklyLimitReached ? "disabled" : ""}
                        aria-label="${checkedToday ? "Desmarcar hábito" : "Completar hábito"}">${checkedToday ? "✓" : ""}</button>
                    <button class="icon-btn" aria-label="Editar hábito" title="Editar hábito"
                        onclick="editHabit('${habit.id}')">✎</button>
                    <button class="icon-btn" aria-label="Eliminar hábito" title="Eliminar hábito"
                        onclick="deleteItem('habit','${habit.id}')">×</button>
                </div>
            </div>

            ${goalTarget ? `
                <div class="habit-goal">
                    <div class="habit-goal-heading">
                        <span>Objetivo</span>
                        <strong>${todayValue === null || todayValue === undefined ? "Sin registrar" : `${todayValue} / ${goalTarget}`}</strong>
                    </div>
                    <input id="habitProgress-${habit.id}" class="habit-progress-input"
                        aria-label="Valor conseguido hoy para ${escapeHTML(habit.name)}"
                        type="number" min="0" step="any" placeholder="Valor conseguido hoy"
                        ${checkedToday ? `value="${todayValue ?? ""}"` : ""}>
                </div>
            ` : ""}

            <div class="habit-metrics">
                <span>Racha <strong class="${streak ? "habit-streak-active" : ""}">🔥 ${streak} ${streak === 1 ? "día" : "días"}</strong></span>
                <span>Cumplimiento <strong>${completionRate}%</strong></span>
                ${habit.frequency === "weekly" ? `<span>Esta semana <strong>${thisWeekCount}/${habit.weeklyTarget}</strong></span>` : ""}
                <span>Hoy <strong>${checkedToday ? "Completado" : weeklyLimitReached ? "Objetivo semanal alcanzado" : "Pendiente"}</strong></span>
            </div>

            <div class="progress-line habit-compliance">
                <div style="width:${completionRate}%"></div>
            </div>

            <div class="habit-card-history" aria-label="Historial de los últimos 14 días">
                ${history.map(entry => `
                    <span class="habit-history-cell ${entry.completed ? "completed" : ""}"
                        title="${escapeHTML(formatDate(entry.date))}: ${entry.completed ? "Completado" : "No completado"}"></span>
                `).join("")}
            </div>
        </article>
    `;

}


function renderHabitHistory() {

    const container = document.getElementById("habitHistory");
    const days = [];

    for (let offset = 13; offset >= 0; offset--) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const key = getDateKey(date);
        const completed = data.habits.filter(
            habit => isHabitCompletedOnDate(habit, date)
        );
        const xp = completed.reduce(
            (sum, habit) => sum + getCompletionXP(habit.completions[key]),
            0
        );

        days.push(`
            <div class="habit-history-day">
                <span>${escapeHTML(date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" }))}</span>
                <strong>${completed.length}/${data.habits.length}</strong>
                <small>${xp} XP</small>
            </div>
        `);
    }

    container.innerHTML = days.join("");

}


/* ================= TASKS ================= */

function comparePendingTasks(a, b) {

    const priorityDifference =
        TASK_PRIORITY_ORDER.indexOf(a.priority) - TASK_PRIORITY_ORDER.indexOf(b.priority);

    if (priorityDifference) return priorityDifference;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);

    return a.createdAt.localeCompare(b.createdAt);

}


function renderTasks() {

    const today = getDateKey();
    const filter = document.getElementById("taskFilter").value;
    const completedTasks = data.tasks.filter(task => task.completed);
    const pendingTasks = data.tasks.filter(task => !task.completed);
    const overdueTasks = pendingTasks.filter(task => isTaskOverdue(task, today));
    const highPriorityTasks = data.tasks.filter(task => task.priority === "high");
    const total = data.tasks.length;
    const completed = completedTasks.length;

    const progress =
        total
            ? Math.round(
                completed / total * 100
            )
            : 0;

    document.getElementById(
        "taskTotal"
    ).textContent =
        total;

    document.getElementById(
        "taskCompleted"
    ).textContent =
        completed;

    document.getElementById("taskPending").textContent = pendingTasks.length;
    document.getElementById(
        "taskProgress"
    ).textContent =
        `${progress}%`;
    document.getElementById("taskProgressCount").textContent =
        `${completed} / ${total} completadas`;

    document.getElementById("taskOverdue").textContent = overdueTasks.length;
    document.getElementById("taskHighPriority").textContent = highPriorityTasks.length;

    const taskStreak = calculateTaskStreak();
    document.getElementById("taskStreak").textContent =
        `${taskStreak} ${taskStreak === 1 ? "día" : "días"}`;

    const matchesFilter = task => {
        switch (filter) {
            case "pending": return !task.completed;
            case "completed": return task.completed;
            case "high":
            case "medium":
            case "low": return task.priority === filter;
            case "overdue": return isTaskOverdue(task, today);
            default: return true;
        }
    };
    const filtered = data.tasks.filter(matchesFilter);
    const pending = filtered
        .filter(task => !task.completed)
        .sort(comparePendingTasks);
    const completedFiltered = filtered
        .filter(task => task.completed)
        .sort((a, b) => b.completedDate.localeCompare(a.completedDate));

    const sections = document.querySelectorAll("#tasksList > section");
    sections[0].hidden = filter === "completed";
    sections[1].hidden = filter === "pending" || filter === "overdue";

    document.getElementById("pendingTaskCount").textContent = pending.length;
    document.getElementById("completedTaskCount").textContent =
        completedFiltered.length;

    document.getElementById("pendingTasksList").innerHTML = pending.length
        ? pending.map(renderTaskCard).join("")
        : `<div class="empty">No tienes tareas pendientes.</div>`;
    document.getElementById("completedTasksList").innerHTML =
        completedFiltered.length
            ? completedFiltered.map(renderTaskCard).join("")
            : `<div class="empty">Todavía no has completado tareas.</div>`;

}


function renderTaskCard(item) {

    const priorityLabels = {
        low: "Baja",
        medium: "Media",
        high: "Alta"
    };
    const overdue = isTaskOverdue(item);
    const dueLabel = item.dueDate
        ? overdue
            ? `<span class="task-due-overdue">Vencida · ${escapeHTML(formatDate(new Date(`${item.dueDate}T12:00:00`)))}</span>`
            : `Fecha límite · ${escapeHTML(formatDate(new Date(`${item.dueDate}T12:00:00`)))}`
        : "";

    return `

            <div class="data-card ${overdue ? "task-overdue" : ""}">

                <div class="data-card-top">

                    <div>

                        <h4>
                            ${escapeHTML(item.name)}
                        </h4>

                        <p>
                            +${item.xp} XP · <span class="task-priority">Prioridad ${priorityLabels[item.priority] || "Media"}</span>
                            ${dueLabel ? ` · ${dueLabel}` : ""}
                        </p>
                        ${item.description ? `<p class="task-description">${escapeHTML(item.description)}</p>` : ""}

                    </div>

                    <div class="card-actions">

                        <button
                            class="check ${item.completed ? "done" : ""}"
                            onclick="toggleItem('task','${item.id}')"
                            aria-label="${item.completed ? "Marcar pendiente" : "Completar tarea"}"
                        >
                            ${item.completed ? "✓" : ""}
                        </button>

                        <button
                            class="icon-btn"
                            aria-label="Editar tarea"
                            title="Editar tarea"
                            onclick="editTask('${item.id}')"
                        >
                            ✎
                        </button>

                        <button
                            class="icon-btn"
                            aria-label="Eliminar tarea"
                            title="Eliminar tarea"
                            onclick="deleteItem('task','${item.id}')"
                        >
                            ×
                        </button>

                    </div>

                </div>

                <div class="card-progress">

                    <div class="card-progress-text">

                        <span>
                            Estado
                        </span>

                        <span>
                            ${item.completed ? "Completada" : "Pendiente"}
                        </span>

                    </div>

                    <div class="progress-line">

                        <div
                            style="width:${item.completed ? 100 : 0}%"
                        ></div>

                    </div>

                </div>

            </div>

        `;

}


function editTask(id) {
    return runSafely(
        "editTask",
        () => editTaskUnsafe(id),
        "No se pudo abrir la tarea para editarla. Inténtalo de nuevo."
    );
}

function editTaskUnsafe(id) {
    const task = data.tasks.find(
        item => item.id === id
    );

    if (task) {
        openModal("task", task);
        return true;
    }

    return false;

}


/* ================= CALENDAR ================= */

let calendarDate =
    new Date();
let selectedAgendaDate =
    getDateKey();


function renderCalendar() {

    const calendar =
        document.getElementById(
            "calendar"
        );

    const title =
        document.getElementById(
            "calendarTitle"
        );

    const year =
        calendarDate.getFullYear();

    const month =
        calendarDate.getMonth();

    title.textContent =
        calendarDate.toLocaleDateString(
            "es-ES",
            {
                month: "long",
                year: "numeric"
            }
        );

    calendar.innerHTML = createCalendarMarkup(year, month);

    calendar.querySelectorAll("[data-agenda-date]").forEach(dayButton => {
        dayButton.addEventListener("click", () => {
            selectedAgendaDate = dayButton.dataset.agendaDate;
            runSafely(
                "renderCalendar",
                renderCalendar,
                "No se pudo actualizar la Agenda."
            );
            runSafely(
                "renderAgendaDay",
                renderAgendaDay,
                "No se pudieron mostrar las actividades de este día."
            );
        });
    });

    renderAgendaDay();

}


function createCalendarMarkup(year, month) {

    const firstDay = new Date(year, month, 1);
    const dayCount = new Date(year, month + 1, 0).getDate();

    // Convert Sunday-first indexing to Monday-first.
    const leadingDays = (firstDay.getDay() + 6) % 7;
    const today = getDateKey();
    let html = `<div class="calendar-day"></div>`.repeat(leadingDays);

    for (let day = 1; day <= dayCount; day++) {
        const date = new Date(year, month, day);
        const key = getDateKey(date);
        const isToday = key === today;
        const progress = data.history[key] || 0;
        const hasTasks = data.tasks.some(task => task.dueDate === key);
        const completedHabits = data.habits.some(
            habit => isHabitCompletedOnDate(habit, date)
        );

        html += `
            <button
                class="calendar-day ${isToday ? "today" : ""} ${selectedAgendaDate === key ? "selected" : ""}"
                data-agenda-date="${key}"
                aria-label="${escapeHTML(formatDate(date))}"
                aria-pressed="${selectedAgendaDate === key}"
            >
                <strong>${day}</strong>
                ${hasTasks || completedHabits ? `<span class="calendar-activity-dot"></span>` : ""}
                ${progress > 0 ? `<div class="calendar-progress">${progress}% progreso</div>` : ""}
            </button>
        `;
    }

    return html;

}


function renderAgendaDay() {

    const [year, month, day] = selectedAgendaDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const container = document.getElementById("agendaDayActivities");
    const title = document.getElementById("agendaDayTitle");
    const activities = [];

    title.textContent = formatDate(date);

    for (const habit of data.habits) {
        if (isHabitCompletedOnDate(habit, date)) {
            activities.push(`
                <div class="list-item">
                    <div class="item-content">
                        <strong>${escapeHTML(habit.name)}</strong>
                        <small>Hábito completado · ${habit.frequency === "weekly" ? "Semanal" : "Diario"}</small>
                    </div>
                    <span class="item-xp">+${getCompletionXP(habit.completions[selectedAgendaDate])} XP</span>
                </div>
            `);
        }
    }

    for (const task of data.tasks.filter(item => item.dueDate === selectedAgendaDate)) {
        activities.push(`
            <div class="list-item">
                <div class="item-content">
                    <strong>${escapeHTML(task.name)}</strong>
                    <small>Tarea · ${task.completed ? "Completada" : "Pendiente"}</small>
                </div>
                <span class="item-xp">+${task.xp} XP</span>
            </div>
        `);
    }

    container.innerHTML = activities.length
        ? activities.join("")
        : `<div class="empty">No hay actividades para este día.</div>`;

}


document.getElementById(
    "prevMonth"
).addEventListener(
    "click",
    () => {

        calendarDate = new Date(
            calendarDate.getFullYear(),
            calendarDate.getMonth() - 1,
            1
        );
        selectedAgendaDate = getDateKey(calendarDate);

        runSafely("renderCalendar", renderCalendar,
            "No se pudo actualizar la Agenda.");

    }
);


document.getElementById(
    "nextMonth"
).addEventListener(
    "click",
    () => {

        calendarDate = new Date(
            calendarDate.getFullYear(),
            calendarDate.getMonth() + 1,
            1
        );
        selectedAgendaDate = getDateKey(calendarDate);

        runSafely("renderCalendar", renderCalendar,
            "No se pudo actualizar la Agenda.");

    }
);

document.getElementById("agendaTodayBtn").addEventListener("click", () => {
    selectedAgendaDate = getDateKey();
    calendarDate = new Date();
    runSafely("renderCalendar", renderCalendar,
        "No se pudo actualizar la Agenda.");
});


document.getElementById("taskFilter").addEventListener("change", () =>
    runSafely("renderTasks", renderTasks, "No se pudieron mostrar las tareas.")
);


/* ================= CHART ================= */

function createDateRange(days, endDate = new Date()) {

    const end = new Date(endDate);
    end.setHours(12, 0, 0, 0);

    return Array.from({ length: days }, (_, index) => {
        const date = new Date(end);
        date.setDate(end.getDate() - (days - index - 1));
        return { date, key: getDateKey(date) };
    });

}


function getAnalyticsSeries(periodValue = 30) {

    const endDate = new Date();
    endDate.setHours(12, 0, 0, 0);
    const endKey = getDateKey(endDate);
    let dates;

    if (periodValue === "all") {
        const recordedDateSet = new Set([
            ...Object.keys(data.taskHistory || {}),
            ...data.habits.flatMap(habit => Object.keys(habit.completions || {}))
        ]);
        const recordedDates = [...recordedDateSet]
            .filter(key => isValidDateKey(key) && key <= endKey)
            .sort();
        const startCandidates = [...recordedDates];
        const createdAt = Date.parse(data.createdAt || "");
        if (Number.isFinite(createdAt)) {
            startCandidates.push(getDateKey(new Date(createdAt)));
        }
        for (const task of data.tasks) {
            const created = Date.parse(task.createdAt || "");
            if (Number.isFinite(created)) startCandidates.push(getDateKey(new Date(created)));
        }
        for (const habit of data.habits) {
            if (isValidDateKey(habit.createdOn)) startCandidates.push(habit.createdOn);
        }
        const firstDate = startCandidates
            .filter(key => isValidDateKey(key) && key <= endKey)
            .sort()[0];

        if (firstDate) {
            const cursor = new Date(`${firstDate}T12:00:00`);
            dates = [];
            while (getDateKey(cursor) <= endKey) {
                dates.push({ date: new Date(cursor), key: getDateKey(cursor) });
                cursor.setDate(cursor.getDate() + 1);
            }
        } else {
            dates = [{ date: endDate, key: endKey }];
        }
    } else {
        dates = createDateRange(Number(periodValue) || 30, endDate);
    }

    const points = dates.map(({ date, key }) => ({
        date,
        key,
        taskCount: 0,
        habitCount: 0,
        taskXP: 0,
        habitXP: 0,
        xp: 0,
        activity: 0,
        value: 0
    }));
    const pointByDate = new Map(points.map(point => [point.key, point]));

    for (const [key, records] of Object.entries(data.taskHistory || {})) {
        const point = pointByDate.get(key);
        if (!point) continue;

        point.taskCount += records.length;
        point.taskXP += records.reduce(
            (sum, record) => sum + (Number(record.xp) || 0),
            0
        );
    }

    for (const habit of data.habits) {
        for (const [key, record] of Object.entries(habit.completions || {})) {
            const point = pointByDate.get(key);
            if (!point) continue;

            point.habitCount++;
            point.habitXP += getCompletionXP(record);
        }
    }

    for (const point of points) {
        point.xp = point.taskXP + point.habitXP;
        point.activity = point.taskCount + point.habitCount;
        point.value = point.activity;
    }

    return points;

}


function drawChart(svgId, days = 7) {

    const svg = document.getElementById(svgId);
    if (!svg) return;

    const width = svg.viewBox.baseVal.width || 700;
    const height = svg.viewBox.baseVal.height || 280;
    const padding = 25;
    const values = createDateRange(Number(days) || 7).map(
        entry => Number(data.history[entry.key]) || 0
    );
    const points = values.map((value, index) => {
        const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
        const y = height - padding - (value / 100) * (height - padding * 2);
        return `${x},${y}`;
    }).join(" ");
    const firstPoint = points.split(" ")[0];
    const lastPoint = points.split(" ").at(-1);
    const areaPoints = `${firstPoint.split(",")[0]},${height-padding} ${points} ${lastPoint.split(",")[0]},${height-padding}`;

    svg.innerHTML = `
        <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#e5e5e5" />
                <stop offset="100%" stop-color="#e5e5e5" stop-opacity="0" />
            </linearGradient>
        </defs>
        <line class="chart-grid" x1="25" y1="25" x2="${width - 25}" y2="25" />
        <line class="chart-grid" x1="25" y1="${height / 2}" x2="${width - 25}" y2="${height / 2}" />
        <line class="chart-grid" x1="25" y1="${height - 25}" x2="${width - 25}" y2="${height - 25}" />
        <polygon class="chart-area" points="${areaPoints}" />
        <polyline class="chart-line" points="${points}" />
        ${values.map((value, index) => {
            const [x, y] = points.split(" ")[index].split(",");
            return `<circle class="chart-point" cx="${x}" cy="${y}" r="5" title="${value}%" />`;
        }).join("")}
    `;

}


function calculateHabitBestStreak(habit) {

    const completedKeys = Object.keys(habit.completions || {}).sort();
    let best = 0;
    let current = 0;
    let previousKey = "";

    if (habit.frequency === "weekly") {
        const completionsByWeek = new Map();
        for (const key of completedKeys) {
            const [year, month, day] = key.split("-").map(Number);
            const weekKey = getWeekKey(new Date(year, month - 1, day));
            completionsByWeek.set(weekKey, (completionsByWeek.get(weekKey) || 0) + 1);
        }

        const completedWeeks = [...completionsByWeek.entries()]
            .filter(([, count]) => count >= habit.weeklyTarget)
            .map(([weekKey]) => {
                const [year, week] = weekKey.split("-W").map(Number);
                const jan4 = new Date(year, 0, 4);
                const monday = new Date(jan4);
                monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
                return getDateKey(monday);
            })
            .sort();

        for (const key of completedWeeks) {
            const previous = previousKey ? new Date(`${previousKey}T12:00:00`) : null;
            if (previous) previous.setDate(previous.getDate() + 7);
            current = previous && getDateKey(previous) === key ? current + 1 : 1;
            best = Math.max(best, current);
            previousKey = key;
        }

        return best;
    }

    for (const key of completedKeys) {
        const previous = previousKey ? new Date(`${previousKey}T12:00:00`) : null;
        if (previous) previous.setDate(previous.getDate() + 1);
        current = previous && getDateKey(previous) === key ? current + 1 : 1;
        best = Math.max(best, current);
        previousKey = key;
    }

    return best;

}


function getHabitPeriodStats(habit, dates) {

    const eligibleDates = dates.filter(entry =>
        entry.key >= habit.createdOn && entry.key <= getDateKey()
    );
    const completedDates = eligibleDates.filter(entry =>
        Object.prototype.hasOwnProperty.call(habit.completions || {}, entry.key)
    );

    if (habit.frequency === "weekly") {
        const weeks = new Map();
        for (const entry of eligibleDates) {
            const [year, month, day] = entry.key.split("-").map(Number);
            const weekKey = getWeekKey(new Date(year, month - 1, day));
            weeks.set(weekKey, (weeks.get(weekKey) || 0) + 1);
        }

        const completedByWeek = new Map();
        for (const entry of completedDates) {
            const [year, month, day] = entry.key.split("-").map(Number);
            const weekKey = getWeekKey(new Date(year, month - 1, day));
            completedByWeek.set(weekKey, (completedByWeek.get(weekKey) || 0) + 1);
        }

        const possible = weeks.size;
        const achieved = [...weeks.keys()].filter(
            week => (completedByWeek.get(week) || 0) >= habit.weeklyTarget
        ).length;
        return {
            completions: completedDates.length,
            possible,
            achieved,
            rate: possible ? Math.round(achieved / possible * 100) : null
        };
    }

    return {
        completions: completedDates.length,
        possible: eligibleDates.length,
        achieved: completedDates.length,
        rate: eligibleDates.length
            ? Math.round(completedDates.length / eligibleDates.length * 100)
            : null
    };

}


function getTaskPeriodStats(dates) {

    const periodKeys = new Set(dates.map(entry => entry.key));
    const firstKey = dates[0]?.key || getDateKey();
    const lastKey = dates.at(-1)?.key || getDateKey();
    const completedIds = new Set();
    let completed = 0;
    let xp = 0;

    for (const [key, records] of Object.entries(data.taskHistory || {})) {
        if (!periodKeys.has(key)) continue;
        for (const record of records) {
            completed++;
            xp += Number(record.xp) || 0;
            completedIds.add(record.id);
        }
    }

    const candidateIds = new Set(completedIds);
    for (const task of data.tasks) {
        const createdKey = getDateKey(new Date(task.createdAt));
        const completedBeforePeriod =
            task.completed && task.completedDate && task.completedDate < firstKey;
        if (createdKey <= lastKey && !completedBeforePeriod) {
            candidateIds.add(task.id);
        }
    }

    const pending = data.tasks.filter(task => !task.completed).length;
    const overdue = data.tasks.filter(task => isTaskOverdue(task)).length;

    return {
        completed,
        uniqueCompleted: completedIds.size,
        candidates: candidateIds.size,
        pending,
        overdue,
        rate: candidateIds.size
            ? Math.round(completedIds.size / candidateIds.size * 100)
            : null,
        xp
    };

}


function getPeriodMetrics(series) {

    return series.reduce((totals, point) => {
        totals.tasks += point.taskCount;
        totals.habits += point.habitCount;
        totals.xp += point.xp;
        totals.activity += point.activity;
        if (point.activity > 0) totals.activeDays++;
        return totals;
    }, { tasks: 0, habits: 0, xp: 0, activity: 0, activeDays: 0 });

}


function calculateProductivityScore(series, taskStats, habitStats) {

    const components = [];
    if (taskStats.candidates) {
        components.push({ weight: 40, value: taskStats.rate / 100 });
    }
    if (habitStats.possible) {
        components.push({ weight: 40, value: habitStats.rate / 100 });
    }
    if (taskStats.candidates || habitStats.possible) {
        components.push({
            weight: 20,
            value: series.length ? getPeriodMetrics(series).activeDays / series.length : 0
        });
    }

    if (!components.length) return null;

    const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
    return Math.round(
        components.reduce((sum, component) => sum + component.value * component.weight, 0) /
            totalWeight * 100
    );

}


function getComparisonValue(current, previous) {

    if (previous === 0) {
        return current === 0
            ? "0% · sin cambio"
            : `Nuevo · +${current.toLocaleString()} (base 0)`;
    }

    const change = Math.round((current - previous) / previous * 100);
    return `${change > 0 ? "+" : ""}${change}%`;

}


function renderComparison(periodValue, currentSeries) {

    const ids = [
        "analyticsCompareTasks",
        "analyticsCompareHabits",
        "analyticsCompareXP",
        "analyticsCompareActivity"
    ];
    const note = document.getElementById("analyticsComparisonNote");

    if (periodValue === "all") {
        ids.forEach(id => { document.getElementById(id).textContent = "—"; });
        note.textContent = "La comparación no está disponible para Todo el tiempo porque no existe un periodo anterior de igual duración.";
        return;
    }

    const days = Number(periodValue) || 30;
    const previousEnd = new Date(currentSeries[0].date);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousSeries = createDateRange(days, previousEnd)
        .map(entry => ({ ...entry, taskCount: 0, habitCount: 0, xp: 0, activity: 0 }));
    const previousPointByDate = new Map(previousSeries.map(point => [point.key, point]));

    for (const [key, records] of Object.entries(data.taskHistory || {})) {
        const point = previousPointByDate.get(key);
        if (!point) continue;
        point.taskCount += records.length;
        point.xp += records.reduce((sum, record) => sum + (Number(record.xp) || 0), 0);
    }
    for (const habit of data.habits) {
        for (const [key, record] of Object.entries(habit.completions || {})) {
            const point = previousPointByDate.get(key);
            if (!point) continue;
            point.habitCount++;
            point.xp += getCompletionXP(record);
        }
    }
    for (const point of previousSeries) {
        point.activity = point.taskCount + point.habitCount;
    }

    const createdAt = Date.parse(data.createdAt || "");
    const previousStart = previousSeries[0]?.date;
    const trackingStarted = Number.isFinite(createdAt) && previousStart
        ? new Date(createdAt).setHours(0, 0, 0, 0) <= previousStart.getTime()
        : Object.keys(data.taskHistory || {}).length > 0 ||
            data.habits.some(habit => Object.keys(habit.completions || {}).length > 0);

    if (!trackingStarted) {
        ids.forEach(id => { document.getElementById(id).textContent = "—"; });
        note.textContent = "Datos insuficientes: el periodo anterior queda antes del inicio del historial disponible.";
        return;
    }

    const current = getPeriodMetrics(currentSeries);
    const previous = getPeriodMetrics(previousSeries);
    const values = [current.tasks, current.habits, current.xp, current.activity];
    const previousValues = [previous.tasks, previous.habits, previous.xp, previous.activity];
    ids.forEach((id, index) => {
        document.getElementById(id).textContent =
            getComparisonValue(values[index], previousValues[index]);
    });
    note.textContent = `Comparación con los ${days} días inmediatamente anteriores.`;

}


function drawAnalyticsChart(series, metric) {

    const svg = document.getElementById("analyticsChart");
    const summary = document.getElementById("analyticsChartSummary");
    const title = document.getElementById("analyticsChartTitle");
    const metricNames = {
        activity: "Actividad diaria",
        xp: "XP por día",
        tasks: "Tareas completadas por día",
        habits: "Hábitos completados por día"
    };
    title.textContent = metricNames[metric] || metricNames.activity;

    if (!series.some(point => point.activity > 0)) {
        svg.innerHTML = "";
        summary.textContent = "Sin datos. Completa algunas tareas o hábitos para generar estadísticas.";
        return;
    }

    const width = svg.viewBox.baseVal.width || 900;
    const height = svg.viewBox.baseVal.height || 350;
    const left = 48;
    const right = 18;
    const top = 20;
    const bottom = 36;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = series.map(point => Number(point[metric]) || 0);
    const maxValue = Math.max(1, values.reduce((max, value) => Math.max(max, value), 0));
    const points = values.map((value, index) => {
        const x = left + (index / Math.max(1, values.length - 1)) * plotWidth;
        const y = top + plotHeight - (value / maxValue) * plotHeight;
        return { x, y, value, source: series[index] };
    });
    const coordinates = points.map(point => `${point.x},${point.y}`).join(" ");
    const areaPoints = `${left},${height - bottom} ${coordinates} ${width - right},${height - bottom}`;
    const tickIndexes = [...new Set([
        0,
        Math.round((series.length - 1) / 2),
        series.length - 1
    ])];
    const tickValues = [maxValue, Math.round(maxValue / 2), 0];
    const markerStep = Math.max(1, Math.ceil(points.length / 90));

    svg.innerHTML = `
        <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#e5e5e5" />
                <stop offset="100%" stop-color="#e5e5e5" stop-opacity="0" />
            </linearGradient>
        </defs>
        ${tickValues.map((value, index) => {
            const y = top + (index / 2) * plotHeight;
            return `
                <line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" />
                <text class="chart-axis-label" x="${left - 8}" y="${y + 4}" text-anchor="end">${value}</text>
            `;
        }).join("")}
        <polygon class="chart-area" points="${areaPoints}" />
        <polyline class="chart-line" points="${coordinates}" />
        ${points.map((point, index) => index % markerStep === 0 || index === points.length - 1
            ? `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4"
                title="${escapeHTML(formatDate(point.source.date))}: ${point.value}" />`
            : "").join("")}
        ${tickIndexes.map(index => {
            const x = left + (index / Math.max(1, series.length - 1)) * plotWidth;
            const label = series[index].date.toLocaleDateString("es-ES", {
                day: "numeric",
                month: "short",
                year: series.length > 90 ? "2-digit" : undefined
            });
            return `<text class="chart-axis-label" x="${x}" y="${height - 8}" text-anchor="middle">${escapeHTML(label)}</text>`;
        }).join("")}
    `;

    summary.textContent = `${metricNames[metric] || metricNames.activity} · escala diaria; las tareas y hábitos se cuentan al completarse.`;

}


function resetAnalyticsToEmptyState(message = ANALYTICS_EMPTY_STATE) {
    const valueIds = [
        "averageProgress",
        "analyticsTaskPeriod",
        "analyticsCurrentStreak",
        "bestStreak",
        "analyticsXP",
        "analyticsConsistency",
        "analyticsHabitCompletions",
        "analyticsTaskTotal",
        "analyticsTaskCompleted",
        "analyticsTaskPending",
        "analyticsTaskRate",
        "analyticsTaskOverdue",
        "analyticsTaskXP",
        "analyticsPriorityHigh",
        "analyticsPriorityMedium",
        "analyticsPriorityLow",
        "analyticsActiveHabits",
        "analyticsHabitTotal",
        "analyticsHabitRate",
        "analyticsHabitXP",
        "analyticsHabitStreak"
    ];
    valueIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.textContent = message;
    });
    ["analyticsTotalXP", "analyticsTaskPeriodRate"].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.textContent = message;
    });
    [
        "analyticsHabitRanking",
        "analyticsBestDays",
        "analyticsHeatmap"
    ].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.innerHTML = `<p class="empty">${escapeHTML(message)}</p>`;
    });
    ["analyticsTrend", "analyticsTrendDetail", "analyticsComparisonNote",
        "analyticsChartSummary", "analyticsEmptyState"].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = message;
            if (id === "analyticsEmptyState") element.hidden = false;
        }
    });
    ["analyticsCompareTasks", "analyticsCompareHabits", "analyticsCompareXP",
        "analyticsCompareActivity"].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.textContent = message;
    });
    const chart = document.getElementById("analyticsChart");
    if (chart) chart.innerHTML = "";
}


function renderAnalytics() {
    try {
        const periodControl = document.getElementById("analyticsRange");
        const metricControl = document.getElementById("analyticsMetric");
        if (!periodControl || !metricControl) {
            resetAnalyticsToEmptyState(ANALYTICS_EMPTY_STATE);
            return;
        }

        const metrics = calculateAnalyticsMetrics(
            periodControl.value,
            metricControl.value
        );
        if (!metrics) {
            resetAnalyticsToEmptyState(ANALYTICS_EMPTY_STATE);
            return;
        }

        runSafely(
            "renderAnalyticsCards",
            () => renderAnalyticsCards(metrics),
            "No se pudieron mostrar los resúmenes de Analytics."
        );
        runSafely(
            "renderAnalyticsChart",
            () => renderAnalyticsChart(metrics),
            "No se pudieron mostrar los gráficos de Analytics."
        );
        runSafely(
            "renderAnalyticsRanking",
            () => renderAnalyticsRanking(metrics.habitStats),
            "No se pudo mostrar el ranking de hábitos."
        );

        const emptyState = document.getElementById("analyticsEmptyState");
        emptyState.hidden = metrics.hasLoggedActivity;
        emptyState.textContent = metrics.hasLoggedActivity
            ? ""
            : `${ANALYTICS_EMPTY_STATE}. Completa algunas tareas o hábitos para generar estadísticas.`;
    } catch (error) {
        handleAppError(
            "renderAnalytics",
            error,
            "No se pudieron calcular las estadísticas. Puedes seguir usando el resto de la app."
        );
        resetAnalyticsToEmptyState(ANALYTICS_EMPTY_STATE);
    }

}


function calculateAnalyticsMetrics(periodValue, metric) {
    try {
        if (!Array.isArray(data?.habits) || !Array.isArray(data?.tasks) ||
            !data.habits.every(Validators.validateHabit) ||
            !data.tasks.every(Validators.validateTask) ||
            !data.taskHistory || typeof data.taskHistory !== "object" ||
            Array.isArray(data.taskHistory) ||
            !Object.values(data.taskHistory).every(records =>
                Array.isArray(records) && records.every(record =>
                    record && typeof record.id === "string" &&
                    Number.isFinite(Number(record.xp)) && Number(record.xp) >= 0
                )
            ) ||
            !data.history || typeof data.history !== "object" ||
            Array.isArray(data.history) ||
            !Object.values(data.history).every(value =>
                Number.isFinite(Number(value)) && Number(value) >= 0
            )) {
            return null;
        }

        const dateRange = getAnalyticsSeries(periodValue);
        const periodMetrics = getPeriodMetrics(dateRange);
        const taskStats = getTaskPeriodStats(dateRange);
        const habitStats = calculateAnalyticsHabitStats(dateRange);
        const completedHabitOpportunities = habitStats.reduce(
            (sum, habit) => sum + habit.achieved,
            0
        );
        const possibleHabitOpportunities = habitStats.reduce(
            (sum, habit) => sum + habit.possible,
            0
        );
        const habitRate = possibleHabitOpportunities
            ? Math.round(completedHabitOpportunities / possibleHabitOpportunities * 100)
            : null;

        return {
            periodValue,
            metric,
            dateRange,
            periodMetrics,
            taskStats,
            habitStats,
            habitRate,
            productivityScore: calculateProductivityScore(
                dateRange,
                taskStats,
                {
                    achieved: completedHabitOpportunities,
                    possible: possibleHabitOpportunities,
                    rate: habitRate ?? 0
                }
            ),
            hasLoggedActivity: periodMetrics.activity > 0,
            hasStreakHistory: Object.values(data.history).some(value => value > 0),
            currentStreak: calculateStreak(),
            bestStreak: calculateBestStreak(),
            tasks: data.tasks,
            habits: data.habits,
            totalXP: Number(data.totalXP) || 0
        };
    } catch (error) {
        handleAppError(
            "calculateAnalyticsMetrics",
            error,
            "No se pudieron calcular las estadísticas de Analytics."
        );
        return null;
    }

}


function renderAnalyticsCards(metrics) {
    try {
        const {
            productivityScore,
            periodMetrics,
            taskStats,
            habitStats,
            habitRate,
            hasStreakHistory,
            currentStreak,
            bestStreak,
            dateRange,
            hasLoggedActivity,
            periodValue,
            totalXP
        } = metrics;

        document.getElementById("averageProgress").textContent =
            productivityScore === null ? "—" : `${productivityScore}%`;
        document.getElementById("analyticsTaskPeriod").textContent =
            periodMetrics.tasks.toLocaleString();
        document.getElementById("analyticsTaskPeriodRate").textContent =
            taskStats.rate === null
                ? "Datos insuficientes"
                : `${taskStats.rate}% de tareas del periodo`;
        document.getElementById("analyticsCurrentStreak").textContent =
            hasStreakHistory
                ? `${currentStreak} ${currentStreak === 1 ? "día" : "días"}`
                : "—";
        document.getElementById("bestStreak").textContent =
            hasStreakHistory
                ? `${bestStreak} ${bestStreak === 1 ? "día" : "días"}`
                : "—";
        document.getElementById("analyticsXP").textContent =
            `${periodMetrics.xp.toLocaleString()} XP`;
        document.getElementById("analyticsTotalXP").textContent =
            totalXP.toLocaleString();
        document.getElementById("analyticsConsistency").textContent =
            habitRate === null ? "—" : `${habitRate}%`;
        document.getElementById("analyticsHabitCompletions").textContent =
            periodMetrics.habits.toLocaleString();

        runSafely(
            "renderAnalyticsTaskStats",
            () => renderAnalyticsTaskStats(taskStats, periodMetrics, dateRange, metrics.tasks),
            "No se pudieron mostrar las estadísticas de tareas."
        );
        runSafely(
            "renderAnalyticsHabitStats",
            () => renderAnalyticsHabitStats(habitStats, periodMetrics, habitRate, metrics.habits),
            "No se pudieron mostrar las estadísticas de hábitos."
        );
        runSafely(
            "renderAnalyticsInsights",
            () => renderAnalyticsInsights(dateRange, hasLoggedActivity),
            "No se pudieron mostrar las tendencias de Analytics."
        );
        runSafely(
            "renderComparison",
            () => renderComparison(periodValue, dateRange),
            "No se pudo comparar el periodo de Analytics."
        );

        document.getElementById("averageProgress").title =
            "Productividad = 40% tasa de tareas + 40% cumplimiento de hábitos + 20% días activos; los pesos disponibles se normalizan si una categoría no tiene datos.";
    } catch (error) {
        handleAppError("renderAnalyticsCards", error, "No se pudieron mostrar los resúmenes de Analytics.");
    }

}


function renderAnalyticsChart(metrics) {
    try {
        drawAnalyticsChart(metrics.dateRange, metrics.metric);
        renderHeatmap(metrics.dateRange);
    } catch (error) {
        handleAppError("renderAnalyticsChart", error, "No se pudieron mostrar los gráficos de Analytics.");
    }

}


function calculateAnalyticsHabitStats(dateRange) {

    return data.habits.map(habit => {
        const period = getHabitPeriodStats(habit, dateRange);
        const xp = dateRange.reduce((sum, entry) => {
            return sum + (
                entry.key in habit.completions
                    ? getCompletionXP(habit.completions[entry.key])
                    : 0
            );
        }, 0);
        return {
            habit,
            ...period,
            xp,
            currentStreak: calculateHabitStreak(habit),
            bestStreak: calculateHabitBestStreak(habit)
        };
    });

}


function renderAnalyticsTaskStats(taskStats, periodMetrics, dateRange, tasks) {

    document.getElementById("analyticsTaskTotal").textContent =
        tasks.length.toLocaleString();
    document.getElementById("analyticsTaskCompleted").textContent =
        periodMetrics.tasks.toLocaleString();
    document.getElementById("analyticsTaskPending").textContent =
        taskStats.pending.toLocaleString();
    document.getElementById("analyticsTaskRate").textContent =
        taskStats.rate === null ? "—" : `${taskStats.rate}%`;
    document.getElementById("analyticsTaskOverdue").textContent =
        taskStats.overdue.toLocaleString();
    document.getElementById("analyticsTaskXP").textContent =
        taskStats.xp.toLocaleString();

    const completedTaskIdsByPriority = new Map(
        TASK_PRIORITY_ORDER.map(priority => [priority, new Set()])
    );
    const activeTasksById = new Map(tasks.map(task => [task.id, task]));
    for (const entry of dateRange) {
        for (const record of data.taskHistory?.[entry.key] || []) {
            const task = activeTasksById.get(record.id);
            if (task) completedTaskIdsByPriority.get(task.priority).add(task.id);
        }
    }
    for (const priority of TASK_PRIORITY_ORDER) {
        const total = tasks.filter(task => task.priority === priority).length;
        const completed = completedTaskIdsByPriority.get(priority).size;
        document.getElementById(`analyticsPriority${priority[0].toUpperCase()}${priority.slice(1)}`).textContent =
            `${completed} / ${total}`;
    }

}


function renderAnalyticsHabitStats(habitStats, periodMetrics, habitRate, habits) {

    document.getElementById("analyticsActiveHabits").textContent =
        habits.length.toLocaleString();
    document.getElementById("analyticsHabitTotal").textContent =
        periodMetrics.habits.toLocaleString();
    document.getElementById("analyticsHabitRate").textContent =
        habitRate === null ? "—" : `${habitRate}%`;
    document.getElementById("analyticsHabitXP").textContent =
        habitStats.reduce((sum, habit) => sum + habit.xp, 0).toLocaleString();
    document.getElementById("analyticsHabitStreak").textContent =
        habitStats.length && habitStats.some(habit => habit.bestStreak)
            ? "Ver ranking"
            : "Datos insuficientes";

}


function renderAnalyticsRanking(habitStats) {
    try {
        const ranking = document.getElementById("analyticsHabitRanking");
        if (!habitStats.length) {
            ranking.innerHTML = `<p class="empty">Aún no hay hábitos activos.</p>`;
            return;
        }

        const orderedHabits = [...habitStats].sort((a, b) =>
            (b.rate ?? -1) - (a.rate ?? -1) ||
            a.habit.name.localeCompare(b.habit.name, "es")
        );
        ranking.innerHTML = orderedHabits.map((entry, index) => `
            <div class="analytics-ranking-row">
                <span class="analytics-ranking-position">${index + 1}</span>
                <div class="analytics-ranking-name">
                    <strong>${escapeHTML(entry.habit.name)}</strong>
                    <small>${entry.completions} completaciones · ${entry.xp.toLocaleString()} XP · ${entry.currentStreak || entry.bestStreak ? `racha ${entry.currentStreak}/${entry.bestStreak} ${entry.habit.frequency === "weekly" ? "sem." : "días"}` : "sin racha registrada"}</small>
                </div>
                <strong>${entry.rate === null ? "—" : `${entry.rate}%`}</strong>
                <div class="progress-line"><div style="width:${entry.rate ?? 0}%"></div></div>
            </div>
        `).join("");
    } catch (error) {
        handleAppError("renderAnalyticsRanking", error, "No se pudo mostrar el ranking de hábitos.");
    }

}


function renderAnalyticsInsights(dateRange, hasLoggedActivity) {

    const activityPoints = dateRange.filter(point => point.activity > 0);
    const bestDays = document.getElementById("analyticsBestDays");
    if (!activityPoints.length) {
        bestDays.innerHTML = `<p class="empty">${ANALYTICS_EMPTY_STATE}. Completa algunas tareas o hábitos para identificar tus mejores días.</p>`;
    } else {
        const topDays = [...activityPoints]
            .sort((a, b) => b.activity - a.activity || a.key.localeCompare(b.key))
            .slice(0, 3);
        bestDays.innerHTML = topDays.map(point => `
            <div class="analytics-best-day">
                <span>${escapeHTML(point.date.toLocaleDateString("es-ES", {
                    weekday: "short",
                    day: "numeric",
                    month: "short"
                }))}</span>
                <strong>${point.activity} ${point.activity === 1 ? "actividad" : "actividades"}</strong>
            </div>
        `).join("");
    }

    const trend = document.getElementById("analyticsTrend");
    const trendDetail = document.getElementById("analyticsTrendDetail");
    const midpoint = Math.floor(dateRange.length / 2);
    const firstHalf = dateRange.slice(0, midpoint);
    const secondHalf = dateRange.slice(midpoint);
    if (dateRange.length < 2 || !hasLoggedActivity) {
        trend.textContent = hasLoggedActivity ? "Datos insuficientes" : ANALYTICS_EMPTY_STATE;
        trendDetail.textContent = "Se necesita actividad registrada en el periodo para calcular la tendencia.";
    } else {
        const firstAverage = firstHalf.reduce((sum, point) => sum + point.activity, 0) /
            Math.max(1, firstHalf.length);
        const secondAverage = secondHalf.reduce((sum, point) => sum + point.activity, 0) /
            Math.max(1, secondHalf.length);
        let trendLabel;
        if (firstAverage === 0) {
            trendLabel = secondAverage > 0 ? "Tendencia positiva" : "Tendencia estable";
        } else {
            const change = (secondAverage - firstAverage) / firstAverage;
            trendLabel = change > 0.05
                ? "Tendencia positiva"
                : change < -0.05 ? "Tendencia negativa" : "Tendencia estable";
        }
        trend.textContent = trendLabel;
        trendDetail.textContent =
            `Actividad media diaria: ${firstAverage.toFixed(2)} → ${secondAverage.toFixed(2)}. Se compara actividad completada (tareas + hábitos), no fechas programadas.`;
    }

}


document.getElementById(
    "chartRange"
).addEventListener(
    "change",
    event => {

        runSafely(
            "drawChart",
            () => drawChart(
                "progressChart",
                Number(event.target.value)
            ),
            "No se pudo mostrar el gráfico de progreso."
        );

    }
);


function renderHeatmap(series) {

    const container = document.getElementById("analyticsHeatmap");
    const maxActivity = Math.max(
        1,
        series.reduce((max, point) => Math.max(max, point.activity), 0)
    );
    container.innerHTML = series.map(point => {
        const intensity = point.activity === 0
            ? 0
            : Math.min(4, Math.ceil(point.activity / maxActivity * 4));
        return `
            <div class="heatmap-day intensity-${intensity}"
                title="${escapeHTML(formatDate(point.date))}: ${point.activity} actividades"></div>
        `;
    }).join("");

}


const achievementDefinitions = [
    {
        id: "first",
        icon: "⚡",
        title: "FIRST STEP",
        description: "Completa tu primer elemento.",
        rewardXp: 25,
        progress: () => ({
            current: Object.values(data.history).some(value => value > 0) ? 1 : 0,
            target: 1
        }),
        unlocked: () => Object.values(data.history).some(value => value > 0)
    },
    {
        id: "week",
        icon: "🔥",
        title: "7 DAYS",
        description: "Consigue una racha de 7 días.",
        rewardXp: 50,
        progress: () => ({ current: Math.min(7, data.bestStreak), target: 7 }),
        unlocked: () => data.bestStreak >= 7
    },
    {
        id: "xp500",
        icon: "✦",
        title: "500 XP",
        description: "Consigue 500 XP.",
        rewardXp: 75,
        progress: () => ({ current: Math.min(500, data.totalXP), target: 500 }),
        unlocked: () => data.totalXP >= 500
    },
    {
        id: "diamond",
        icon: "◆",
        title: "DIAMOND",
        description: "Alcanza el rango DIAMOND.",
        rewardXp: 250,
        progress: () => ({ current: Math.min(10000, data.totalXP), target: 10000 }),
        unlocked: () => data.totalXP >= 10000
    },
    {
        id: "perfect",
        icon: "◎",
        title: "90%",
        description: "Consigue un día con 90% o más.",
        rewardXp: 100,
        progress: () => ({
            current: Object.values(data.history).some(value => value >= 90) ? 1 : 0,
            target: 1
        }),
        unlocked: () => Object.values(data.history).some(value => value >= 90)
    },
    {
        id: "weekperfect",
        icon: "★",
        title: "PERFECT WEEK",
        description: "Consigue 7 días con al menos 80%.",
        rewardXp: 150,
        progress: () => ({ current: getPerfectWeekProgress(), target: 7 }),
        unlocked: () => getPerfectWeekProgress() >= 7
    },
    {
        id: "task-first",
        icon: "✓",
        title: "FIRST TASK",
        description: "Completa tu primera tarea.",
        rewardXp: 20,
        progress: () => ({
            current: Math.min(1, getTotalTaskCompletions()),
            target: 1
        }),
        unlocked: () => getTotalTaskCompletions() >= 1
    },
    {
        id: "task-5",
        icon: "☷",
        title: "5 TASKS",
        description: "Completa 5 tareas.",
        rewardXp: 30,
        progress: () => ({
            current: Math.min(5, getTotalTaskCompletions()),
            target: 5
        }),
        unlocked: () => getTotalTaskCompletions() >= 5
    },
    {
        id: "task-10",
        icon: "◆",
        title: "10 TASKS",
        description: "Completa 10 tareas.",
        rewardXp: 50,
        progress: () => ({
            current: Math.min(10, getTotalTaskCompletions()),
            target: 10
        }),
        unlocked: () => getTotalTaskCompletions() >= 10
    },
    {
        id: "task-25",
        icon: "★",
        title: "25 TASKS",
        description: "Completa 25 tareas.",
        rewardXp: 100,
        progress: () => ({
            current: Math.min(25, getTotalTaskCompletions()),
            target: 25
        }),
        unlocked: () => getTotalTaskCompletions() >= 25
    }
];

const newlyUnlockedAchievements = new Set();


function isAchievementUnlocked(achievement) {

    return Boolean(
        data.achievements[achievement.id] || achievement.unlocked()
    );

}


function getPerfectWeekProgress() {

    let count = 0;
    const today = new Date();

    for (let offset = 0; offset < 7; offset++) {
        const date = new Date(today);
        date.setDate(today.getDate() - offset);
        if ((data.history[getDateKey(date)] || 0) >= 80) count++;
    }

    return count;

}


function syncAchievementRewards() {

    data.achievements = data.achievements || {};

    for (const achievement of achievementDefinitions) {
        if (isAchievementUnlocked(achievement) && !data.achievements[achievement.id]) {
            data.achievements[achievement.id] = true;
            newlyUnlockedAchievements.add(achievement.id);
            data.totalXP += achievement.rewardXp;
        }
    }

}


/* ================= ACHIEVEMENTS ================= */

function renderAchievements() {

    const container =
        document.getElementById(
            "achievementsList"
        );

    const unlockedCount = achievementDefinitions.filter(
        isAchievementUnlocked
    ).length;
    const earnedXp = achievementDefinitions.reduce(
        (sum, achievement) =>
            sum + (data.achievements[achievement.id] ? achievement.rewardXp : 0),
        0
    );

    document.getElementById("unlockedAchievements").textContent =
        `${unlockedCount}/${achievementDefinitions.length}`;
    document.getElementById("achievementXP").textContent =
        earnedXp.toLocaleString();

    container.innerHTML =
        achievementDefinitions.map(
            achievement => {
                const unlocked = isAchievementUnlocked(achievement);
                const progress = achievement.progress();
                if (data.achievements[achievement.id]) {
                    progress.current = progress.target;
                }

                return `
                <div class="achievement ${
                    unlocked
                        ? ""
                        : "locked"
                } ${newlyUnlockedAchievements.has(achievement.id) ? "newly-unlocked" : ""}">

                    <div class="achievement-icon">
                        ${achievement.icon}
                    </div>

                    <h4>
                        ${achievement.title}
                    </h4>

                    <p>
                        ${achievement.description}
                    </p>

                    <div class="achievement-progress">
                        <div class="progress-line">
                            <div style="width:${Math.min(100, progress.current / progress.target * 100)}%"></div>
                        </div>
                        <small>${unlocked ? "Desbloqueado" : `${progress.current}/${progress.target}`} · +${achievement.rewardXp} XP</small>
                    </div>

                </div>

            `;
            }
        ).join("");

    if (document.getElementById("achievements").classList.contains("active")) {
        newlyUnlockedAchievements.clear();
    }

}


function checkPerfectWeek() {

    return getPerfectWeekProgress() >= 7;

}


/* ================= SECURITY ================= */

function escapeHTML(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


/* ================= GLOBAL RENDER ================= */

function renderAll() {

    runSafely(
        "saveTodayProgress",
        saveTodayProgress,
        "No se pudo actualizar el progreso de hoy."
    );
    runSafely(
        "syncAchievementRewards",
        syncAchievementRewards,
        "No se pudieron actualizar los logros."
    );
    const activeSection = document.querySelector(".page.active")?.id;

    runSafely("renderDashboard", renderDashboard,
        "No se pudo actualizar el Dashboard.");
    runSafely("renderHabits", renderHabits,
        "No se pudieron mostrar los hábitos.");
    runSafely("renderHabitHistory", renderHabitHistory,
        "No se pudo mostrar el historial de hábitos.");
    runSafely("renderTasks", renderTasks,
        "No se pudieron mostrar las tareas.");
    runSafely("renderCalendar", renderCalendar,
        "No se pudo actualizar la Agenda.");
    renderAnalytics();
    runSafely("renderAchievements", renderAchievements,
        "No se pudieron mostrar los logros.");

    if (activeSection === "dashboard") {
        runSafely(
            "drawChart",
            () => drawChart(
                "progressChart",
                Number(document.getElementById("chartRange").value)
            ),
            "No se pudo mostrar el gráfico de progreso."
        );
    }

    saveDataSafely();

}


function saveDataSafely() {
    runSafely(
        "Storage.save",
        () => {
            data.currentRank = getRank(data.totalXP).name;
            const saved = Storage.save(data);
            if (!saved) {
                console.error("Failed to persist changes");
                return;
            }

            if (!isInitializing && currentUser && isSupabaseEnabled()) {
                if (remoteSyncReady) {
                    syncInBackground();
                } else {
                    hasOfflineChanges = true;
                }
            }
        },
        "No se pudieron guardar los cambios. Comprueba el almacenamiento del navegador."
    );
}


function syncInBackground() {
    hasOfflineChanges = true;
    void SupabaseModule.sync(data)
        .then(synced => {
            hasOfflineChanges = !synced;
        })
        .catch(error => {
            hasOfflineChanges = true;
            console.warn("La sincronización con Supabase no está disponible:", error);
        });
}


function showLogin(message = "") {
    document.getElementById("login-page").hidden = false;
    document.querySelector(".app").hidden = true;
    document.getElementById("login-message").textContent = message;
}


function showAuthenticatedApp() {
    document.getElementById("login-page").hidden = true;
    document.querySelector(".app").hidden = false;
}


async function activateUser(user) {
    if (!user?.id) {
        throw new Error("No se pudo identificar la cuenta autenticada.");
    }

    currentUser = user;
    Storage.setUserId(user.id);
    const localData = Storage.load();
    const remoteData = await SupabaseModule.loadUserData();

    if (remoteData) {
        const { hasRemoteData, ...savedRemoteData } = remoteData;
        data = hasRemoteData
            ? { ...defaultData, ...savedRemoteData }
            : localData;
        remoteSyncReady = true;

        if (hasRemoteData) {
            if (Storage.save(data)) {
                data = Storage.load();
            }
        }
    } else {
        data = localData;
        remoteSyncReady = false;
        hasOfflineChanges = false;
        console.warn("FOCUSEX está trabajando con los datos locales hasta recuperar la conexión.");
    }

    showAuthenticatedApp();
    renderAll();
    isInitializing = false;
    if (remoteSyncReady) syncInBackground();
    scheduleNextDayRefresh();
}


function setAuthBusy(isBusy) {
    document.querySelectorAll("#login-page button").forEach(button => {
        button.disabled = isBusy;
    });
}


async function runAuthAction(action) {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const message = document.getElementById("login-message");

    if (!email || !password) {
        message.textContent = "Introduce tu correo y contraseña.";
        return;
    }

    setAuthBusy(true);
    message.textContent = "";

    try {
        const result = await action(email, password);
        if (result.session && result.user) {
            await activateUser(result.user);
        } else if (result.user) {
            message.textContent = "Cuenta creada. Revisa tu correo para confirmar la dirección antes de iniciar sesión.";
        } else {
            message.textContent = "No se pudo iniciar la sesión. Inténtalo de nuevo.";
        }
    } catch (error) {
        console.error("Error de autenticación:", error);
        message.textContent = error.message || "No se pudo completar la autenticación.";
    } finally {
        setAuthBusy(false);
    }
}


async function initializeApp() {
    if (!isSupabaseEnabled()) {
        showLogin("Supabase no está configurado. Comprueba la URL y la clave publishable.");
        return;
    }

    const client = SupabaseModule.init(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
    if (!client) {
        showLogin("No se pudo conectar con Supabase. Comprueba la configuración y recarga la página.");
        return;
    }

    const user = await SupabaseModule.getCurrentUser();
    if (!user) {
        showLogin();
        return;
    }

    try {
        await activateUser(user);
    } catch (error) {
        console.error("No se pudo cargar FOCUSEX:", error);
        showLogin("No se pudieron cargar tus datos. Inténtalo de nuevo.");
    }
}


window.addEventListener("online", async () => {
    if (!currentUser || remoteSyncReady) return;

    const remoteData = await SupabaseModule.loadUserData();
    if (!remoteData) return;

    remoteSyncReady = true;
    if (!hasOfflineChanges && remoteData.hasRemoteData) {
        const { hasRemoteData, ...savedRemoteData } = remoteData;
        data = { ...defaultData, ...savedRemoteData };
        if (Storage.save(data)) {
            data = Storage.load();
        }
    }

    renderAll();
});


document.getElementById("login-form").addEventListener("submit", event => {
    event.preventDefault();
    void runAuthAction(SupabaseModule.signIn);
});

document.getElementById("signup-button").addEventListener("click", () => {
    void runAuthAction(SupabaseModule.signUp);
});

document.getElementById("signout-button").addEventListener("click", async () => {
    const button = document.getElementById("signout-button");
    button.disabled = true;
    try {
        await SupabaseModule.signOut();
        Storage.clear();
        Storage.setUserId(null);
        currentUser = null;
        remoteSyncReady = false;
        hasOfflineChanges = false;
        isInitializing = true;
        data = structuredClone(defaultData);
        showLogin("Has cerrado sesión.");
    } catch (error) {
        console.error("No se pudo cerrar la sesión:", error);
        alert(error.message || "No se pudo cerrar la sesión.");
    } finally {
        button.disabled = false;
    }
});

document.getElementById("analyticsRange").addEventListener(
    "change",
    () => renderAnalytics()
);

document.getElementById("analyticsMetric").addEventListener(
    "change",
    () => renderAnalytics()
);


/* ================= DATE UI ================= */

document.getElementById(
    "todayDate"
).textContent =
    formatDate();


function scheduleNextDayRefresh() {
    if (!currentUser) return;

    const now = new Date();
    const nextDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1
    );

    setTimeout(() => {
        if (currentUser) {
            document.getElementById(
                "todayDate"
            ).textContent = formatDate();

            renderAll();
        }
        scheduleNextDayRefresh();
    }, Math.max(0, nextDay - now));

}


/* ================= INITIALIZE ================= */

void initializeApp();