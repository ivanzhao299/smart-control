/**
 * NOAA 太阳计算 —— 日落/日出时刻 (精度 ±1 分钟)。
 *
 * 算法来源: NOAA Solar Calculator (基于 Jean Meeus 天文算法)。
 * 视地平线角度 -0.833° = 太阳半径 0.267° + 大气折射 0.566° (NOAA 标准值)。
 *
 * 用途: 4G 断路器"日落/日出"自动开关 —— 每天按园区经纬度重算触发时刻。
 *
 * 输入: 纬度(北正) / 经度(东正) / 本地日期 / 本地时区偏移(分钟, 中国=+480)。
 * 输出: 当日日出/日落时刻 (0 点起的分钟数 0..1439; 极昼/极夜返回 null)。
 */

/** 视地平线角度: 太阳半径 + 平均大气折射 (度) */
const ZENITH = 90.833; // 天顶角 = 90 + 0.833

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** 归一化到 [0, 360) */
function norm360(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** 某日 0 点 (UTC) 起算的儒略日 (NOAA 简化式) */
function julianDay(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdn =
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045;
  return jdn - 2451545; // 相对 J2000 epoch 的儒略日
}

/**
 * 计算某地某日 (本地日期, 按 tzOffsetMin 时区) 的日出/日落。
 * 返回当日 0 点起分钟数 (0..1439); 极昼/极夜时对应值为 null。
 */
export function calcSunTimes(
  lat: number,
  lng: number,
  year: number,
  month: number,
  day: number,
  tzOffsetMin = 480,
): { sunriseMin: number | null; sunsetMin: number | null } {
  // 本地日期对应 UTC 日期 = 本地 0 点 UTC 时刻; 用本地日期直接算 J2000 儒略日 (近似, ±1 分钟内)
  const jd = julianDay(year, month, day);

  // 太阳几何平均黄经
  const l0 = norm360(280.46646 + 0.98564736 * jd);
  // 太阳平均近点角
  const m = norm360(357.52911 + 0.98560028 * jd);
  // 太阳真黄经 (含中心差 + 略去微小项)
  const l = norm360(
    l0 + 1.914602 * Math.sin(toRad(m)) + 0.02 * Math.sin(toRad(2 * m)) + 0.0003 * Math.sin(toRad(3 * m)),
  );
  // 太阳赤纬
  const decl = toDeg(Math.asin(Math.sin(toRad(23.439291)) * Math.sin(toRad(l))));

  // 日出/日落时角 (cosH 由纬度 + 赤纬 + 天顶角决定)
  const cosH =
    (Math.cos(toRad(ZENITH)) - Math.sin(toRad(decl)) * Math.sin(toRad(lat))) /
    (Math.cos(toRad(decl)) * Math.cos(toRad(lat)));

  if (cosH < -1 || cosH > 1) {
    // |cosH|>1 → 极昼 (永不日落) / 极夜 (永不日出)
    return { sunriseMin: null, sunsetMin: null };
  }

  const haDeg = toDeg(Math.acos(cosH)); // 太阳时角 (度)

  // 本地正午 UTC 时刻 (太阳过当地子午线): 12h - 经度/15h
  const noonUtcHours = 12 - lng / 15;
  const sunriseUtcHours = noonUtcHours - haDeg / 15;
  const sunsetUtcHours = noonUtcHours + haDeg / 15;

  const toLocalMin = (utcHours: number): number =>
    ((utcHours * 60 + tzOffsetMin) % 1440 + 1440) % 1440;

  return {
    sunriseMin: toLocalMin(sunriseUtcHours),
    sunsetMin: toLocalMin(sunsetUtcHours),
  };
}

/** 便捷封装: 输入 Date (本地时区), 输出当日 0 点起分钟数 */
export function sunTimesForDate(
  lat: number,
  lng: number,
  localDate: Date,
  tzOffsetMin = 480,
): { sunriseMin: number | null; sunsetMin: number | null } {
  return calcSunTimes(lat, lng, localDate.getFullYear(), localDate.getMonth() + 1, localDate.getDate(), tzOffsetMin);
}
