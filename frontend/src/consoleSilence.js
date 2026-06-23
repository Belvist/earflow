if (process.env.NODE_ENV === 'production') {
    const noop = () => { };
    try {
        console.log = noop;
        console.info = noop;
        console.debug = noop;
        console.warn = noop;
        console.error = noop;
    } catch {
        // ignore
    }
}
