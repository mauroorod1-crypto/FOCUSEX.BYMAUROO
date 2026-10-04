(function(global) {
    function isRecord(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function validateDate(dateStr) {
        if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return false;
        }

        const date = new Date(`${dateStr}T00:00:00.000Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
    }

    function validateHabit(habit) {
        if (!isRecord(habit) ||
            typeof habit.name !== "string" ||
            habit.name.trim().length < 1 ||
            habit.name.trim().length > 100 ||
            !Number.isFinite(Number(habit.xp)) ||
            Number(habit.xp) < 1 ||
            !["daily", "weekly"].includes(habit.frequency)) {
            return false;
        }

        if (habit.frequency === "weekly" &&
            (!Number.isInteger(Number(habit.weeklyTarget)) ||
                Number(habit.weeklyTarget) < 1 ||
                Number(habit.weeklyTarget) > 7)) {
            return false;
        }

        const targetValue = habit.goal?.targetValue;
        return targetValue === undefined ||
            targetValue === null ||
            (Number.isFinite(Number(targetValue)) && Number(targetValue) > 0);
    }

    function validateTask(task) {
        if (!isRecord(task) ||
            typeof task.name !== "string" ||
            task.name.trim().length < 1 ||
            task.name.trim().length > 200 ||
            !Number.isFinite(Number(task.xp)) ||
            Number(task.xp) < 0 ||
            !["low", "medium", "high"].includes(task.priority)) {
            return false;
        }

        return !task.dueDate ||
            (typeof task.dueDate === "string" && validateDate(task.dueDate));
    }

    global.ValidatorsModule = Object.freeze({
        validateHabit,
        validateTask,
        validateDate
    });
})(globalThis);
