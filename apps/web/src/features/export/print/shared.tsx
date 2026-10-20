/** Small pieces several report bodies share. */
import type { ReportImage } from '../topicReportModel';

export function imageCaption(i: ReportImage): string {
  return i.kind === 'screenshot' ? `Capture of the source page, ${i.credit}` : `Image: ${i.credit}`;
}
