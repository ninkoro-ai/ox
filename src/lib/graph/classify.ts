// 自然人 / 境外公司识别（名称启发式 + 企业类型辅助）

const COMPANY_TOKEN_RE =
  /有限公司|股份公司|有限责任公司|股份有限公司|集团|控股|合伙|基金|银行|证券|保险|信托|投资|资产|资本|实业|科技|能源|建设|交通|发展|贸易|供应链|租赁|保理|担保|融资|网络|信息|软件|咨询|管理|服务|园区|平台|中心|委员会|管理局|财政局|国资委|政府|公司|合作社|学校|医院|研究院|学院|协会|商会|联合会|办公室|事务所|厂|店|市场|中国|石油|石化|电力|铁路|煤炭|钢铁|化工|汽车|地产|建工|市政|燃气|水务|航空|船舶|广电|出版|报业|集团股份|股份有限|有限责任公司|控股集团/;

const OVERSEAS_NAME_RE =
  /香港|澳门|台湾|台港澳|英属维尔京|维尔京|开曼|百慕大|萨摩亚|境外|外国|新加坡|日本|美国|德国|法国|英国|加拿大|澳大利亚|BVI|CAYMAN|VIRGIN|BERMUDA|SAMOA|LIMITED|LTD|CORP|INC|HOLDING|HOLDINGS|GROUP|INTERNATIONAL|GLOBAL|COMPANY|HONG\s*KONG|HONGKONG|\(HK\)/i;

const OVERSEAS_TYPE_RE = /外国|境外|外商|外资|港澳台|台港澳/;

const PERSONAL_TYPE_RE = /自然人|个人/;

// 繁体字公司名（如“中國旭陽集團”），默认按境外主体处理
const TRADITIONAL_CHARS_RE = /[國陽東華萬龍鳳豐發寶億興業來為與長門關開間雙對聖賢廣遠臺澳]/;

function hasAny(s: string, re: RegExp): boolean {
  re.lastIndex = 0;
  return re.test(s);
}

export function isLikelyNaturalPerson(name: string, entityType?: string | null): boolean {
  const n = (name ?? '').trim();
  if (!n || n === '其他' || n === '无' || n === '未知' || n === '-') return false;
  if (entityType && hasAny(entityType, PERSONAL_TYPE_RE)) return true;
  // 纯中文 2~4 字且不含企业特征词 → 大概率自然人
  if (/^[\u4e00-\u9fa5]{2,4}$/.test(n)) {
    return !hasAny(n, COMPANY_TOKEN_RE);
  }
  return false;
}

export function isLikelyOverseas(name: string, entityType?: string | null): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  if (hasAny(n, OVERSEAS_NAME_RE)) return true;
  // 繁体字公司名默认为境外主体（香港/开曼等离岸注册地）
  if (hasAny(n, TRADITIONAL_CHARS_RE)) return true;
  if (entityType) {
    // “港澳台法人独资”仅表示股东为港澳台主体，公司本身仍为境内企业，
    // 因此仅当类型明确含“外国/境外/外资/外商”时视为境外实体
    if (hasAny(entityType, /外国|境外|外资|外商/)) return true;
  }
  return false;
}

// 注册地推断：境外主体按名称中的地名匹配，境内主体统一为中国
const REGION_MAP: Array<[RegExp, string]> = [
  [/香港|HONG\s*KONG|HONGKONG|\(HK\)/i, '香港'],
  [/澳门|澳門|MACAO|MACAU/i, '澳门'],
  [/台湾|臺灣|TAIWAN/i, '台湾'],
  [/英属维尔京|英屬維爾京|BVI|VIRGIN/i, '英属维尔京群岛'],
  [/开曼|開曼|CAYMAN/i, '开曼群岛'],
  [/百慕大|百慕達|BERMUDA/i, '百慕大'],
  [/萨摩亚|薩摩亞|SAMOA/i, '萨摩亚'],
  [/新加坡|SINGAPORE/i, '新加坡'],
  [/日本|JAPAN/i, '日本'],
  [/美国|USA|AMERICA/i, '美国'],
  [/德国|GERMANY/i, '德国'],
  [/法国|FRANCE/i, '法国'],
  [/英国|BRITAIN|UNITED KINGDOM/i, '英国'],
  [/加拿大|CANADA/i, '加拿大'],
  [/澳大利亚|AUSTRALIA/i, '澳大利亚'],
];

export function inferRegPlace(name: string, isOverseas: boolean): string | undefined {
  if (!isOverseas) return '中国';
  const n = (name ?? '').trim();
  for (const [re, label] of REGION_MAP) {
    if (hasAny(n, re)) return label;
  }
  // 繁体字公司名未匹配到具体地名时，默认香港
  if (hasAny(n, TRADITIONAL_CHARS_RE)) return '香港';
  return '境外';
}
