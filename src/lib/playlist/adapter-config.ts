/**
 * 适配器配置持久化
 * 存储/读取 adapter-priority.json，服务器重启后沿用上次测试的排序
 *
 * 两种排除机制：
 *   _dead    — 死源（测试不可用自动加入），自动/手动检测可用后自动移除
 *   _blocked — 屏蔽源（用户手动标记），不参与自动检测，仅用户可手动解除
 * 两者都被排除在解析器和负载均衡器之外
 *
 * _ui — 测试界面设置（并发数、超时、排序模式等），页面关闭后保留
 */
import fs from 'fs';
import path from 'path';
import { Platform } from './types';

const CONFIG_PATH = path.join(process.cwd(), 'src/lib/playlist/adapter-priority.json');

export type PriorityConfig = Partial<Record<Platform, string[]>>;

export type AutoReviveConfig = Partial<Record<Platform, boolean>>;

/** 自动检测间隔 */
export interface AutoReviveInterval {
  value: number;    // 数值
  unit: 'minutes' | 'hours' | 'days';  // 单位
}

export type AutoReviveIntervalConfig = Partial<Record<Platform, AutoReviveInterval>>;

/** 测试界面 UI 设置 */
export interface UiConfig {
  concurrency?: number;    // 并发数，默认 5
  timeoutMs?: number;      // 超时毫秒，默认 8000
  sortMode?: 'quality' | 'speed';  // 排序模式，默认 quality
}

interface RawConfig extends PriorityConfig {
  _dead?: Partial<Record<Platform, string[]>>;
  _blocked?: Partial<Record<Platform, string[]>>;
  _autoRevive?: AutoReviveConfig;
  _autoReviveInterval?: AutoReviveIntervalConfig;
  _ui?: UiConfig;
}

// ── 优先级配置 ──

/** 读取已保存的优先级配置 */
export function loadPriorityConfig(): PriorityConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      // 过滤掉内部字段，只返回排序配置
      const { _dead, _blocked, _autoRevive, _autoReviveInterval, _ui, ...order } = raw;
      return order;
    }
  } catch { /* 文件损坏则忽略 */ }
  return {};
}

/** 保存优先级配置 */
export function savePriorityConfig(config: PriorityConfig): void {
  const raw = loadRawConfig();
  // 合并：保留内部字段，只更新排序部分
  const merged: RawConfig = { ...raw };
  for (const key of Object.keys(config)) {
    merged[key as Platform] = config[key as Platform];
  }
  saveRawConfig(merged);
}

// ── 内部读写 ──

function loadRawConfig(): RawConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveRawConfig(config: RawConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ── 死名单（_dead）管理 ──

export type DeadList = Partial<Record<Platform, string[]>>;

/** 读取全部死名单 */
export function loadDeadList(): DeadList {
  return loadRawConfig()._dead || {};
}

/** 读取指定平台的死名单 */
export function loadDeadListFor(platform: Platform): string[] {
  return loadDeadList()[platform] || [];
}

/** 保存指定平台的死名单 */
export function saveDeadList(platform: Platform, dead: string[]): void {
  const config = loadRawConfig();
  config._dead = { ...config._dead, [platform]: dead };
  saveRawConfig(config);
}

/** 整体替换死名单 */
export function saveDeadListAll(dead: DeadList): void {
  const config = loadRawConfig();
  config._dead = dead;
  saveRawConfig(config);
}

/** 检查某适配器是否在死名单中 */
export function isAdapterDead(platform: Platform, name: string): boolean {
  return loadDeadListFor(platform).includes(name);
}

// ── 屏蔽源（_blocked）管理 ──

export type BlockedList = Partial<Record<Platform, string[]>>;

/** 读取全部屏蔽源 */
export function loadBlockedList(): BlockedList {
  return loadRawConfig()._blocked || {};
}

/** 读取指定平台的屏蔽源 */
export function loadBlockedListFor(platform: Platform): string[] {
  return loadBlockedList()[platform] || [];
}

/** 保存指定平台的屏蔽源 */
export function saveBlockedList(platform: Platform, blocked: string[]): void {
  const config = loadRawConfig();
  config._blocked = { ...config._blocked, [platform]: blocked };
  saveRawConfig(config);
}

/** 检查某适配器是否被手动屏蔽 */
export function isAdapterBlocked(platform: Platform, name: string): boolean {
  return loadBlockedListFor(platform).includes(name);
}

// ── 联合排除：死源 + 屏蔽源 ──

/** 获取所有被排除的适配器名（死源 + 屏蔽源） */
export function loadExcludedListFor(platform: Platform): string[] {
  const dead = loadDeadListFor(platform);
  const blocked = loadBlockedListFor(platform);
  return [...new Set([...dead, ...blocked])];
}

/** 检查适配器是否被排除（死源或屏蔽源） */
export function isAdapterExcluded(platform: Platform, name: string): boolean {
  return isAdapterDead(platform, name) || isAdapterBlocked(platform, name);
}

// ── 自动复活检测配置 ──

/** 读取自动复活检测设置 */
export function loadAutoRevive(): AutoReviveConfig {
  return loadRawConfig()._autoRevive || {};
}

/** 读取指定平台是否开启自动复活检测 */
export function isAutoReviveEnabled(platform: Platform): boolean {
  return loadAutoRevive()[platform] === true;
}

/** 保存自动复活检测设置 */
export function saveAutoRevive(platform: Platform, enabled: boolean): void {
  const config = loadRawConfig();
  config._autoRevive = { ...config._autoRevive, [platform]: enabled };
  saveRawConfig(config);
}

// ── 自动检测间隔配置 ──

const DEFAULT_INTERVAL: AutoReviveInterval = { value: 5, unit: 'minutes' };

/** 读取自动检测间隔 */
export function loadAutoReviveInterval(): AutoReviveIntervalConfig {
  return loadRawConfig()._autoReviveInterval || {};
}

/** 读取指定平台的自动检测间隔 */
export function loadAutoReviveIntervalFor(platform: Platform): AutoReviveInterval {
  return loadAutoReviveInterval()[platform] || DEFAULT_INTERVAL;
}

/** 将间隔转为毫秒 */
export function intervalToMs(interval: AutoReviveInterval): number {
  const { value, unit } = interval;
  switch (unit) {
    case 'minutes': return value * 60 * 1000;
    case 'hours': return value * 60 * 60 * 1000;
    case 'days': return value * 24 * 60 * 60 * 1000;
  }
}

/** 保存自动检测间隔 */
export function saveAutoReviveInterval(platform: Platform, interval: AutoReviveInterval): void {
  const config = loadRawConfig();
  config._autoReviveInterval = { ...config._autoReviveInterval, [platform]: interval };
  saveRawConfig(config);
}

// ── 测试界面 UI 设置 ──

const DEFAULT_UI: UiConfig = {
  concurrency: 5,
  timeoutMs: 8000,
  sortMode: 'quality',
};

/** 读取 UI 设置（合并默认值，保证每个字段都有值） */
export function loadUiConfig(): UiConfig {
  const saved = loadRawConfig()._ui || {};
  return { ...DEFAULT_UI, ...saved };
}

/** 保存 UI 设置（增量合并，只更新传入的字段） */
export function saveUiConfig(patch: Partial<UiConfig>): void {
  const config = loadRawConfig();
  config._ui = { ...loadUiConfig(), ...patch };
  saveRawConfig(config);
}
