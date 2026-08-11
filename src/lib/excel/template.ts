// 人工录入 Excel 模板：边关系设计（投资方 → 被投资方），供无工商数据时手工录入
import * as XLSX from 'xlsx';

/**
 * 生成标准录入模板（.xlsx）：
 * - “股权关系”页：每行一条持股边（投资方名称/投资方类型/被投资方名称/持股比例/层级/备注）
 * - “主体信息”页：公司名称/行业/业务板块/是否授信主体（预留集团授信图使用）
 */
export function createManualTemplateWorkbook(): ArrayBuffer {
  const edgeSheet = XLSX.utils.aoa_to_sheet([
    ['投资方名称', '投资方类型', '被投资方名称', '持股比例', '层级', '备注'],
    ['张三', '自然人', '目标公司', 40, 1, '实际控制人'],
    ['李四投资有限公司', '企业', '目标公司', 60, 1, ''],
    ['王五控股有限公司', '企业', '李四投资有限公司', 100, 2, ''],
  ]);
  edgeSheet['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 18 }];

  const infoSheet = XLSX.utils.aoa_to_sheet([
    ['公司名称', '行业', '业务板块', '是否授信主体'],
    ['目标公司', '制造业', '核心业务', '是'],
    ['李四投资有限公司', '投资', '控股平台', '否'],
    ['王五控股有限公司', '投资', '控股平台', '否'],
  ]);
  infoSheet['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, edgeSheet, '股权关系');
  XLSX.utils.book_append_sheet(wb, infoSheet, '主体信息');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}
