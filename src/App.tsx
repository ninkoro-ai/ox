import { useMemo, useState } from 'react';
import UploadZone from './components/UploadZone';
import SettingsPanel, { DEFAULT_SETTINGS, type SettingsState } from './components/SettingsPanel';
import RelationTable from './components/RelationTable';
import ChartPreview from './components/ChartPreview';
import { buildEquityTree } from './lib/graph/penetrate';
import { fitLayout } from './lib/layout/page';
import { checkLayout } from './lib/layout/collision';
import { renderChartSvg } from './lib/preview/svg';
import { DEFAULT_GENERATE_CONFIG, type GenerateConfig, type ParsedResult } from './lib/types';
import qxbTutorial from './assets/qxb.png';

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function App() {
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [fixNotice, setFixNotice] = useState('');

  // 统一生成配置：穿透阈值 / 合并阈值 / 页面尺寸 / 最小字号
  const generateConfig: GenerateConfig = {
    penetrationThreshold: settings.threshold,
    minorShareholderThreshold: settings.mergeRatio,
    pageSize: settings.pageMode,
    fontMinSize: DEFAULT_GENERATE_CONFIG.fontMinSize,
    layoutMode: settings.layoutMode,
    maxShareholdersPerLevel: settings.maxShareholdersPerLevel,
    capShareholders: settings.capShareholders,
  };

  const tree = useMemo(() => {
    if (!parsed) return null;
    try {
      const t = buildEquityTree(
        parsed.targetName ?? '目标企业',
        parsed.relations,
        parsed.entityTypes ?? {},
        {
          threshold: generateConfig.penetrationThreshold,
          stopAtNaturalPerson: settings.stopNatural,
          stopAtOverseas: settings.stopOverseas,
          showBelowThreshold: settings.showBelowThreshold,
          maxLevel: settings.maxLevel,
          ratioPrecision: settings.ratioPrecision,
        },
      );
      setError('');
      return t;
    } catch (e) {
      setError(`数据处理失败：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, [parsed, generateConfig.penetrationThreshold, settings.stopNatural, settings.stopOverseas, settings.showBelowThreshold, settings.maxLevel, settings.ratioPrecision]);

  const fit = useMemo(() => {
    if (!tree) return null;
    try {
      const f = fitLayout(tree, {
        pageMode: generateConfig.pageSize,
        mergeRatio: generateConfig.minorShareholderThreshold,
        mergeStartLevel: settings.mergeStartLevel,
        layoutMode: generateConfig.layoutMode,
        maxShareholdersPerLevel: generateConfig.maxShareholdersPerLevel,
        capShareholders: generateConfig.capShareholders,
        autoMerge: settings.autoMerge,
        showRegPlace: settings.showRegPlace,
        mergeBelow: settings.mergeBelow,
        ratioPrecision: settings.ratioPrecision,
        textLayout: settings.textLayout,
      });
      setError('');
      return f;
    } catch (e) {
      setError(`图表生成失败：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, [tree, generateConfig.pageSize, generateConfig.minorShareholderThreshold, generateConfig.layoutMode, generateConfig.maxShareholdersPerLevel, generateConfig.capShareholders, settings.mergeStartLevel, settings.autoMerge, settings.showRegPlace, settings.mergeBelow, settings.ratioPrecision, settings.textLayout]);

  const layoutCheck = useMemo(() => (fit ? checkLayout(fit.layout) : null), [fit]);
  const svg = useMemo(
    () => (fit ? renderChartSvg(fit.layout, settings.threshold) : ''),
    [fit, settings.threshold],
  );

  const warnings = useMemo(() => {
    const list = [...(parsed?.warnings ?? []), ...(tree?.warnings ?? []), ...(fit?.warnings ?? [])];
    return Array.from(new Set(list));
  }, [parsed, tree, fit]);

  async function handleFile(file: File) {
    setError('');
    setGenerating(false);
    try {
      const buf = await file.arrayBuffer();
      const { parseWorkbook } = await import('./lib/excel/parse');
      const XLSXLib = await import('xlsx');
      const wb = XLSXLib.read(buf, { type: 'array' });
      const result = parseWorkbook(wb);
      if (result.relations.length === 0) {
        setError('未能从文件中识别出股权关系。请确认是工商股权结构报告（如启信宝层级报告），或包含“股东名称/持股比例/被投资企业”列的表格。');
        return;
      }
      setParsed(result);
      setFileName(file.name);
    } catch (e) {
      setError(`文件读取失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleDownload() {
    if (!parsed || !tree || !fit) return;
    setGenerating(true);
    try {
      const { generatePptx } = await import('./lib/ppt/generatePptx');
      const target = tree.targetName;
      const title = `${target} 股权穿透结构图`;
      const subtitle = `数据来源：工商股权结构报告 · 穿透阈值 ${generateConfig.penetrationThreshold}% · 生成时间 ${new Date().toLocaleString('zh-CN')}`;
      const blob = (await generatePptx(
        {
          tree: fit.tree,
          layout: fit.layout,
          page: fit.page,
          pxToIn: fit.pxToIn,
          title,
          subtitle,
          threshold: generateConfig.penetrationThreshold,
          mergeRatio: generateConfig.minorShareholderThreshold,
          mergedGroups: fit.mergedGroups,
          fontMinSize: generateConfig.fontMinSize,
        },
        'blob',
      )) as Blob;
      saveBlob(blob, `${target}-股权穿透结构图.pptx`);
    } catch (e) {
      setError(`PPT 生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadTemplate() {
    setError('');
    try {
      const { createManualTemplateWorkbook } = await import('./lib/excel/template');
      const buf = createManualTemplateWorkbook();
      saveBlob(
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        '股权结构录入模板.xlsx',
      );
    } catch (e) {
      setError(`模板下载失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 一键修复布局：切换为最稳健的布局参数（自动合并低比例股东、允许第一层合并、页面自动、银行标准版式）
  function handleFixLayout() {
    setSettings((s) => ({
      ...s,
      autoMerge: true,
      mergeStartLevel: 1,
      mergeRatio: Math.min(s.mergeRatio, 10),
      pageMode: 'auto',
      layoutMode: 'bank-ownership',
      capShareholders: true,
    }));
    setFixNotice(
      '已自动调整布局参数：开启每层股东归集、自动合并、页面自动、纵向版式；如仍有问题，请尝试调低“每层最多展示股东数”',
    );
  }

  const parseInfo = parsed ? (
    <div className="parse-info">
      <span>
        <b>文件：</b>
        {fileName}
      </span>
      <span>
        <b>目标企业：</b>
        {parsed.targetName ?? '未识别'}
      </span>
      <span>
        <b>识别到：</b>
        {parsed.relations.length} 条关系 / {parsed.sheets.length} 个分页
      </span>
      <span>
        <b>格式：</b>
        {parsed.format === 'structured-levels'
          ? '分层级工商报告'
          : parsed.format === 'manual-template'
            ? '人工录入模板'
            : '通用表格'}
      </span>
    </div>
  ) : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>股权穿透结构图生成器</h1>
        <p>上传工商股权结构 Excel → 自动穿透 → 生成可编辑的银行授信版股权结构图 PPT</p>
      </header>

      <main>
        <section className="card">
          <h3>① 上传 Excel</h3>
          <UploadZone onFile={handleFile} disabled={generating} />
          <button type="button" className="btn" onClick={handleDownloadTemplate} disabled={generating}>
            下载标准录入模板
          </button>
          <p className="upload-hint">
            没有工商数据？下载标准模板，按“投资方 → 被投资方”逐行录入持股边，再上传即可生成标准授信股权结构 PPT。
          </p>
          <details className="tutorial">
            <summary>如何从启信宝 APP 导出 Excel？</summary>
            <figure className="tutorial-body">
              <img src={qxbTutorial} alt="启信宝 APP 导出 Excel 教程" loading="lazy" />
              <figcaption>
                按图示在启信宝 APP 中打开目标企业 → 进入“股权结构/股东信息”页 → 选择导出 Excel，
                将文件上传到本页即可自动生成股权穿透结构图。
              </figcaption>
            </figure>
          </details>
          {parseInfo}
          {error && <p className="error">{error}</p>}
        </section>

        {parsed && (
          <>
            <SettingsPanel settings={settings} onChange={setSettings} />
            {warnings.length > 0 && (
              <div className="card">
                <h3>提示</h3>
                <ul className="warnings">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <RelationTable
              relations={parsed.relations}
              tree={tree}
              threshold={settings.threshold}
              mergedGroups={fit?.mergedGroups ?? 0}
              mergeRatio={settings.mergeRatio}
            />
            {tree && fit && (
              <ChartPreview
                title={`${tree.targetName} 股权穿透结构图`}
                svg={svg}
                tree={fit.tree}
                layout={fit.layout}
                page={fit.page}
                check={layoutCheck}
                mergedGroups={fit.mergedGroups}
                onDownload={handleDownload}
                onFix={handleFixLayout}
                fixNotice={fixNotice}
                generating={generating}
              />
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        所有解析与计算均在浏览器本地完成，企业数据不会上传至任何服务器
      </footer>
    </div>
  );
}
