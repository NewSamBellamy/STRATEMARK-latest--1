import { METRIC_TYPE_LABELS, type MetricType, type UserFootprintBasis } from './enums';
import { userFootprintLabel } from './user-footprint';

/** A user-count metric is labeled by what it counts, never as generic "users". */
export function metricDisplayLabel(metric: {
  metricType: MetricType;
  userBasis?: UserFootprintBasis;
  methodNote?: string | null;
}): string {
  return metric.metricType === 'users'
    ? userFootprintLabel(metric.userBasis, metric.methodNote)
    : METRIC_TYPE_LABELS[metric.metricType];
}
