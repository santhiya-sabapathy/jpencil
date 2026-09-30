import type { ValueTransformer } from 'typeorm';

/**
 * MySQL returns DECIMAL columns as strings to avoid precision loss. Money
 * values in this API are small enough to be represented safely as JS numbers,
 * so convert them on read to keep the JSON responses numeric.
 */
export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};
