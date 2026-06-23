function validateTitle(title) {
    if (!title || typeof title !== 'string') return 'Некорректное название';
    const trimmed = title.trim();
    if (trimmed.length < 1 || trimmed.length > 120) return 'Название должно быть от 1 до 120 символов';
    return null;
}

function validateDescription(description) {
    if (description === undefined || description === null) return null;
    if (typeof description !== 'string') return 'Некорректное описание';
    if (description.length > 500) return 'Описание не может превышать 500 символов';
    return null;
}

function validateSongIds(ids) {
    if (!Array.isArray(ids)) return 'song_ids должен быть массивом';
    if (ids.length < 1) return 'Нет треков для шаринга';
    if (ids.length > 200) return 'Максимум 200 треков для шаринга';
    return null;
}

module.exports = {
    validateTitle,
    validateDescription,
    validateSongIds,
};
