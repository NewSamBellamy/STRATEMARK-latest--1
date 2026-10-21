import { describe, expect, it, vi } from 'vitest';
import { createResearchControl, RESEARCH_CONTROL_KEY } from './researchControl';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
describe('durable background research control', () => {
  it('keeps pause after a fresh app session and resumes explicitly', () => {
    const disk = storage();
    createResearchControl(disk).getState().setPaused(true);
    const reopened = createResearchControl(disk);
    expect(reopened.getState().paused).toBe(true);
    reopened.getState().setPaused(false);
    expect(createResearchControl(disk).getState().paused).toBe(false);
  });
  it('stops safely when saved settings are malformed or unreadable', () => {
    const disk = storage();
    disk.setItem(RESEARCH_CONTROL_KEY, '{broken');
    expect(createResearchControl(disk).getState().paused).toBe(true);
    expect(createResearchControl({ ...disk, getItem: () => { throw new Error('blocked'); } }).getState().paused).toBe(true);
  });
  it('does not resume or claim persistence when saving fails', () => {
    const control = createResearchControl({ ...storage(), setItem: () => { throw new Error('full'); } });
    control.getState().setPaused(true);
    expect(control.getState().paused).toBe(true);
    expect(control.getState().storageError).toBeTruthy();
    control.getState().setPaused(false);
    expect(control.getState().paused).toBe(true);
  });
  it('reloads changes from another window', () => {
    const disk = storage();
    const first = createResearchControl(disk);
    const second = createResearchControl(disk);
    const notified = vi.fn();
    second.subscribe(notified);
    first.getState().setPaused(true);
    second.getState().reload();
    expect(second.getState().paused).toBe(true);
    expect(notified).toHaveBeenCalled();
  });
});
