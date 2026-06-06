import {
    FaShieldAlt,
    FaLock,
    FaKey,
    FaDesktop,
    FaMobileAlt,
    FaTabletAlt,
    FaQuestionCircle,
    FaExclamationTriangle,
    FaCheckCircle,
    FaInfoCircle,
} from 'react-icons/fa';

export const STAT_ICONS = {
    shield: FaShieldAlt,
    lock: FaLock,
    key: FaKey,
    desktop: FaDesktop,
};

export const DEVICE_ICONS = {
    desktop: FaDesktop,
    mobile: FaMobileAlt,
    tablet: FaTabletAlt,
    unknown: FaQuestionCircle,
};

export const SEVERITY_ICONS = {
    critical: FaExclamationTriangle,
    high: FaExclamationTriangle,
    medium: FaInfoCircle,
    low: FaInfoCircle,
};

export function resolveStatIcon(name) {
    return STAT_ICONS[name] || FaInfoCircle;
}

export function resolveDeviceIcon(type) {
    return DEVICE_ICONS[type] || FaDesktop;
}

export function resolveSeverityIcon(severity) {
    return SEVERITY_ICONS[severity] || FaInfoCircle;
}

export { FaCheckCircle, FaExclamationTriangle, FaShieldAlt };
