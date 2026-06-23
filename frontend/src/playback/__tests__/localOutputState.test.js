import {
    LOCAL_OUTPUT_STATES,
    connectorStateToLocalOutputState,
    normalizeLocalOutputState,
} from '../localOutputState';

describe('local output state', () => {
    test('normalizes explicit local sink states', () => {
        expect(normalizeLocalOutputState('revoked')).toBe(LOCAL_OUTPUT_STATES.REVOKED);
        expect(normalizeLocalOutputState('lost')).toBe(LOCAL_OUTPUT_STATES.LOST);
        expect(normalizeLocalOutputState('unknown', LOCAL_OUTPUT_STATES.SUSPENDED))
            .toBe(LOCAL_OUTPUT_STATES.SUSPENDED);
    });

    test('maps connector states without changing server playback intent', () => {
        expect(connectorStateToLocalOutputState('playing')).toBe(LOCAL_OUTPUT_STATES.ACTIVE);
        expect(connectorStateToLocalOutputState('buffering')).toBe(LOCAL_OUTPUT_STATES.BUFFERING);
        expect(connectorStateToLocalOutputState('paused')).toBe(LOCAL_OUTPUT_STATES.IDLE);
        expect(connectorStateToLocalOutputState('error')).toBe(LOCAL_OUTPUT_STATES.ERROR);
    });
});
