export interface SettingsState {
  threshold: number;
  mergeRatio: number;
  mergeStartLevel: number;
  showBelowThreshold: boolean;
  stopNatural: boolean;
  stopOverseas: boolean;
  maxLevel: number;
  pageMode: 'auto' | '16x9' | 'a4' | 'a3' | 'a2';
  autoMerge: boolean;
  showRegPlace: boolean;
  mergeBelow: boolean;
  ratioPrecision: number;
  textLayout: 'horizontal' | 'vertical' | 'combo';
}

interface Props {
  settings: SettingsState;
  onChange: (s: SettingsState) => void;
  disabled?: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
  threshold: 25,
  mergeRatio: 25,
  mergeStartLevel: 2,
  showBelowThreshold: true,
  stopNatural: true,
  stopOverseas: true,
  maxLevel: 20,
  pageMode: 'auto',
  autoMerge: true,
  showRegPlace: true,
  mergeBelow: false,
  ratioPrecision: 2,
  textLayout: 'horizontal',
};

export default function SettingsPanel({ settings, onChange, disabled }: Props) {
  const set = (patch: Partial<SettingsState>) => onChange({ ...settings, ...patch });
  const num = (v: string, fallback: number, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  };

  return (
    <div className="card">
      <h3>穿透与版式设置</h3>
      <p className="settings-hint">调整任意设置后，预览与导出的 PPT 都会立即按最新参数重新生成。</p>
      <div className="settings-grid">
        <label>
          穿透阈值（%）
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={settings.threshold}
            disabled={disabled}
            onChange={(e) => set({ threshold: num(e.target.value, 25, 0, 100) })}
          />
          <small>第二层起，持股 ≥ 阈值才继续穿透</small>
        </label>
        <label>
          合并阈值（%）
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={settings.mergeRatio}
            disabled={disabled}
            onChange={(e) => set({ mergeRatio: num(e.target.value, 25, 0, 100) })}
          />
          <small>持股低于该比例的股东可归并（勾选下方选项）</small>
        </label>
        <label>
          合并起始层级
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={settings.mergeStartLevel}
            disabled={disabled}
            onChange={(e) => set({ mergeStartLevel: num(e.target.value, 2, 1, 20) })}
          />
          <small>默认 2：第一层（直接股东）不参与合并，从第 N 层起生效</small>
        </label>
        <label>
          持股比例小数位
          <input
            type="number"
            min={0}
            max={4}
            step={1}
            value={settings.ratioPrecision}
            disabled={disabled}
            onChange={(e) => set({ ratioPrecision: num(e.target.value, 2, 0, 4) })}
          />
          <small>默认保留两位小数，可调 0–4 位</small>
        </label>
        <label>
          最大穿透层级
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            value={settings.maxLevel}
            disabled={disabled}
            onChange={(e) => set({ maxLevel: num(e.target.value, 20, 1, 50) })}
          />
        </label>
        <label>
          页面尺寸
          <select
            value={settings.pageMode}
            disabled={disabled}
            onChange={(e) => set({ pageMode: e.target.value as SettingsState['pageMode'] })}
          >
            <option value="auto">自动（16:9 → A3）</option>
            <option value="16x9">16:9</option>
            <option value="a4">A4 横向</option>
            <option value="a3">A3 横向</option>
            <option value="a2">A2 横向</option>
          </select>
          <small>切换页面后图表会重新生成</small>
        </label>
        <label>
          文本框文字方向
          <select
            value={settings.textLayout}
            disabled={disabled}
            onChange={(e) => set({ textLayout: e.target.value as SettingsState['textLayout'] })}
          >
            <option value="horizontal">横向（名称自动换行）</option>
            <option value="vertical">纵向（名称一字一行）</option>
            <option value="combo">横向+纵向组合（股东较多时小于5%自动纵向）</option>
          </select>
          <small>默认横向；组合模式仅在同层股东较多时生效</small>
        </label>
      </div>
      <div className="settings-checks">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.stopNatural}
            disabled={disabled}
            onChange={(e) => set({ stopNatural: e.target.checked })}
          />
          自然人股东停止穿透
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.stopOverseas}
            disabled={disabled}
            onChange={(e) => set({ stopOverseas: e.target.checked })}
          />
          境外公司停止穿透
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.showBelowThreshold}
            disabled={disabled}
            onChange={(e) => set({ showBelowThreshold: e.target.checked })}
          />
          显示未穿透股东（叶子节点）
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoMerge}
            disabled={disabled}
            onChange={(e) => set({ autoMerge: e.target.checked })}
          />
          超出 A3 时自动合并低比例股东
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.showRegPlace}
            disabled={disabled}
            onChange={(e) => set({ showRegPlace: e.target.checked })}
          />
          文本框内展示注册地
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.mergeBelow}
            disabled={disabled}
            onChange={(e) => set({ mergeBelow: e.target.checked })}
          />
          归并低比例股东为“其他单一持股不超过X%的股东”
        </label>
      </div>
    </div>
  );
}
