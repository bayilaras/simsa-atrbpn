export function layananUserName(user, fallback = '-') {
    return user?.name || user?.nama || fallback;
}

export function layananUserInitial(user) {
    const name = layananUserName(user, '');
    return name ? name.charAt(0).toUpperCase() : '?';
}
