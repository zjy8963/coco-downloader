/**
 * 适配器配置持久化
 * 存储/读取 adapter-priority.json，服务器重启后沿用上次测试的排序
 * 同时管理死名单（_dead）：测试确认不可用的适配器
 */
import fs from 'fs';
import path from 'path';
import { Platform } from './types';

const CONFIG_PATH = path.join(process.cwd(), 'src/lib/playlist/adapter-priority.json');

export type PriorityConfig = Partial<Record<Platform, string[]>>;

interface RawConfig extends PriorityConfig {
  _dead?: Partial<Record<Platform, string[]>>;
}

/** 读取已保存的优先级配置 */
export function loadPriorityConfig(): PriorityConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { /* 文件损坏则忽略 */ }
  return {};
}

/** 保存优先级配置 */
export function savePriorityConfig(config: PriorityConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ── 死名单管理 ──

export type DeadList = Partial<Record<Platform, string[]>>;

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
