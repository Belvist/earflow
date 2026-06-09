import { isStepUpRequiredError } from '../../auth/mfaStepUp';

export async function runSensitiveSessionAction({ action, stepUp }) {
  try {
    await action();
    return { ok: true };
  } catch (e) {
    if (!isStepUpRequiredError(e)) {
      throw e;
    }
    return new Promise((resolve, reject) => {
      stepUp.request(async () => {
        try {
          await action();
          resolve({ ok: true });
          return true;
        } catch (retryErr) {
          if (isStepUpRequiredError(retryErr)) {
            return false;
          }
          reject(retryErr);
          return true;
        }
      });
    });
  }
}
