/**
 * 体重的显示单位。存储一律是 kg，这里只决定界面上怎么显示、按钮一次走多少。
 */
export type WeightUnit = 'kg' | 'jin'

/** 1 斤 = 0.5 kg，因此斤显示的数值恒为 kg 的两倍 */
export const KG_PER_JIN = 0.5
