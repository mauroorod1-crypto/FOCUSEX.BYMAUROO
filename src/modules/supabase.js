(function(global) {
    let client = null;
    let syncQueue = Promise.resolve();

    function init(url, key) {
        if (!url || !key || !global.supabase?.createClient) {
            console.error("No se pudo inicializar Supabase. Comprueba la URL, la clave y la conexión.");
            return null;
        }

        try {
            client = global.supabase.createClient(url, key);
            return client;
        } catch (error) {
            console.error("No se pudo inicializar Supabase:", error);
            client = null;
            return null;
        }
    }

    function requireClient() {
        if (!client) {
            throw new Error("El cliente de Supabase no está inicializado.");
        }
        return client;
    }

    async function signUp(email, password) {
        const { data, error } = await requireClient().auth.signUp({
            email: email.trim(),
            password
        });
        if (error) throw error;
        return data;
    }

    async function signIn(email, password) {
        const { data, error } = await requireClient().auth.signInWithPassword({
            email: email.trim(),
            password
        });
        if (error) throw error;
        return data;
    }

    async function signOut() {
        const { error } = await requireClient().auth.signOut({ scope: "local" });
        if (error) throw error;
    }

    async function getCurrentUser() {
        try {
            const { data, error } = await requireClient().auth.getSession();
            if (error) throw error;
            return data.session?.user || null;
        } catch (error) {
            console.warn("No se pudo recuperar la sesión de Supabase:", error);
            return null;
        }
    }

    function isRecord(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function toHabit(row) {
        const details = isRecord(row.details) ? row.details : {};
        return {
            ...details,
            id: row.id,
            name: row.name,
            xp: row.xp_value,
            frequency: row.frequency,
            weeklyTarget: row.weekly_goal,
            color: row.color ?? details.color,
            createdOn: details.createdOn || row.created_at?.slice(0, 10)
        };
    }

    function toTask(row) {
        const details = isRecord(row.details) ? row.details : {};
        return {
            ...details,
            id: row.id,
            name: row.name,
            xp: row.xp_value,
            priority: row.priority,
            completed: row.status === "completed",
            dueDate: row.due_date || "",
            completedDate: row.completed_at
                ? row.completed_at.slice(0, 10)
                : "",
            createdAt: row.created_at
        };
    }

    function toHabitRow(habit, userId) {
        return {
            id: habit.id,
            user_id: userId,
            name: habit.name,
            xp_value: habit.xp,
            frequency: habit.frequency,
            weekly_goal: habit.weeklyTarget,
            color: habit.color ?? null,
            created_at: habit.createdAt || habit.createdOn || new Date().toISOString(),
            details: habit
        };
    }

    function toTaskRow(task, userId) {
        return {
            id: task.id,
            user_id: userId,
            name: task.name,
            xp_value: task.xp,
            priority: task.priority,
            status: task.completed ? "completed" : "pending",
            due_date: task.dueDate || null,
            completed_at: task.completed
                ? task.completedDate
                    ? `${task.completedDate}T00:00:00.000Z`
                    : new Date().toISOString()
                : null,
            created_at: task.createdAt || new Date().toISOString(),
            details: task
        };
    }

    async function getSessionUserId() {
        const { data, error } = await requireClient().auth.getSession();
        if (error) throw error;
        const userId = data.session?.user?.id;
        if (!userId) throw new Error("Se necesita una sesión para sincronizar datos.");
        return userId;
    }

    async function replaceRows(table, rows, userId) {
        if (rows.length) {
            const { error } = await client
                .from(table)
                .upsert(rows, { onConflict: "id" });
            if (error) throw error;
        }

        const { data: existingRows, error: selectError } = await client
            .from(table)
            .select("id")
            .eq("user_id", userId);
        if (selectError) throw selectError;

        const currentIds = new Set(rows.map(row => row.id));
        const staleIds = existingRows
            .map(row => row.id)
            .filter(id => !currentIds.has(id));

        if (staleIds.length) {
            const { error } = await client
                .from(table)
                .delete()
                .eq("user_id", userId)
                .in("id", staleIds);
            if (error) throw error;
        }
    }

    async function persist(data, userId) {
        const supabase = requireClient();
        const globalData = {
            streak: data.streak,
            totalXP: data.totalXP,
            currentRank: data.currentRank || null,
            achievements: data.achievements,
            history: data.history,
            taskHistory: data.taskHistory,
            bestStreak: data.bestStreak,
            createdAt: data.createdAt
        };
        const { error: stateError } = await supabase
            .from("user_data")
            .upsert({
                user_id: userId,
                data: globalData,
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" });
        if (stateError) throw stateError;

        await replaceRows("habits", data.habits.map(habit => toHabitRow(habit, userId)), userId);
        await replaceRows("tasks", data.tasks.map(task => toTaskRow(task, userId)), userId);
        return true;
    }

    function sync(data) {
        if (!data || !Array.isArray(data.habits) || !Array.isArray(data.tasks)) {
            console.warn("Se omitió la sincronización: los datos no tienen una estructura válida.");
            return Promise.resolve(null);
        }

        let snapshot;
        try {
            snapshot = structuredClone(data);
        } catch (error) {
            console.warn("No se pudieron preparar los datos para Supabase:", error);
            return Promise.resolve(null);
        }

        const operation = syncQueue
            .catch(() => null)
            .then(async () => {
                try {
                    const userId = await getSessionUserId();
                    return await persist(snapshot, userId);
                } catch (error) {
                    console.warn("No se pudieron sincronizar los datos con Supabase:", error);
                    return null;
                }
            });

        syncQueue = operation;
        return operation;
    }

    async function loadUserData() {
        try {
            const supabase = requireClient();
            const userId = await getSessionUserId();
            const [stateResult, habitsResult, tasksResult] = await Promise.all([
                supabase.from("user_data").select("data").eq("user_id", userId).maybeSingle(),
                supabase.from("habits").select("*").eq("user_id", userId),
                supabase.from("tasks").select("*").eq("user_id", userId)
            ]);

            const queryError = stateResult.error || habitsResult.error || tasksResult.error;
            if (queryError) throw queryError;

            const state = isRecord(stateResult.data?.data) ? stateResult.data.data : {};
            return {
                ...state,
                habits: (habitsResult.data || []).map(toHabit),
                tasks: (tasksResult.data || []).map(toTask),
                hasRemoteData: Boolean(stateResult.data || habitsResult.data?.length || tasksResult.data?.length)
            };
        } catch (error) {
            console.warn("No se pudieron cargar los datos de Supabase:", error);
            return null;
        }
    }

    global.SupabaseModule = Object.freeze({
        init,
        signUp,
        signIn,
        signOut,
        getCurrentUser,
        sync,
        loadUserData
    });
})(globalThis);
