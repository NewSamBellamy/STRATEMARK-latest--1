import { actionRequestSchema, type ActionReceipt } from '@mi/contracts';

/** Call only after the desktop IPC sender check; identity never comes from the renderer. */
export async function acceptDesktopAction(
  repository: {
    acceptAction(request: unknown, caller: { principalRef: string }): Promise<ActionReceipt>;
  },
  request: unknown,
): Promise<ActionReceipt> {
  return repository.acceptAction(actionRequestSchema.parse(request), {
    principalRef: 'desktop_owner',
  });
}
