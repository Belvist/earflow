export function beginOperation(activeOperationIdRef, activeOperationControllerRef) {
    if (activeOperationControllerRef?.current) {
        try {
            activeOperationControllerRef.current.abort();
        } catch {
        }
    }

    const controller = new AbortController();
    if (activeOperationControllerRef) {
        activeOperationControllerRef.current = controller;
    }

    const nextId = (activeOperationIdRef.current = (activeOperationIdRef.current || 0) + 1);
    return { opId: nextId, signal: controller.signal };
}

export function isOperationActive(activeOperationIdRef, op) {
    return !!op && !op.signal.aborted && activeOperationIdRef?.current === op.opId;
}
