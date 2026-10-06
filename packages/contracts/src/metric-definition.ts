import type { CompanyMetric } from './types';

export type MetricDefinition = NonNullable<CompanyMetric['passageSupport']>['definition'];
const labels: Record<NonNullable<MetricDefinition>, string> = {
  arr: 'ARR', annual_revenue: 'Annual revenue', users: 'Users', active_users: 'Active users',
  monthly_active_users: 'Monthly active users', daily_active_users: 'Daily active users',
  customers: 'Customers', paying_customers: 'Paying customers', employees: 'Employees',
  valuation: 'Valuation', market_cap: 'Market cap', market_share: 'Market share',
};

/** Definition metadata is not proof. Read projections must still validate originals. */
export function metricDefinitionLabel(metric: Pick<CompanyMetric, 'passageSupport'>): string | undefined {
  const definition = metric.passageSupport?.definition;
  return definition ? labels[definition] : undefined;
}

/** Equal values do not make different populations or reporting periods agree. */
export function metricObservationIdentity(metric: Pick<CompanyMetric, 'metricType' | 'passageSupport'>): string {
  const proof = metric.passageSupport;
  return JSON.stringify([proof?.definition ?? metric.metricType, proof?.asOf ?? null, proof?.periodStart ?? null]);
}

/** Existing score/chart axes have no population/interval dimension. Do not mix
 * alternative measurements into them; retain these useful facts on the profile. */
export function comparableMetricBasis(metric: Pick<CompanyMetric, 'metricType' | 'passageSupport'>): boolean {
  const proof = metric.passageSupport;
  if (proof?.definition && proof.definition !== metric.metricType) return false;
  // Old untyped originals must not sneak scoped populations into a total-user axis.
  if (metric.metricType === 'users' && proof && /\b(?:active|monthly|daily|weekly|registered|customers|downloads|installs|followers)\b/i.test(proof.quote)) return false;
  return true;
}
