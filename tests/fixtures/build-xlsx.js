// 生成测试用的 FastMoss 导出文件（表头、单元格类型与 FastMoss「商品搜索 → 导出」一致：数字是数字，售价/百分比/时间是文本）
// 用法：node tests/fixtures/build-xlsx.js
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const HEAD = ['商品名称', '商品状态', '店铺名称', '国家/地区', '商品分类', '售价', '佣金比例', '7天销量', '7天销售额', '28天销量', '28天销售额', '总销量', '总销售额', '带货达人总数', '达人出单率', '带货视频总数', '带货直播总数', '商品图片', 'FastMoss商品详情页地址', 'TikTok商品落地页地址', 'FastMoss店铺详情页地址', '预估商品上架时间'];
const R = (name, shop, price, comm, s7, g7, s28, g28, tot, gtot, cr, rate, v, l, id, listed) => [name, '在售', shop, 'MY', '手机与数码', price, comm, s7, g7, s28, g28, tot, gtot, cr, rate, v, l, '', `https://www.fastmoss.com/zh/e-commerce/detail/${id}`, `https://shop.tiktok.com/view/product/${id}?region=MY&local=en`, 'https://www.fastmoss.com/zh/shop-marketing/detail/1', listed];
const ROWS = [
  R('Mini Sleep Earbuds Wireless Bluetooth Fon Telinga Tidur', 'SleepTech.Store', 'RM34.47', '8%', 1670, 57726, 2772, 95800, 9500, 330000, 291, '100%', 790, 181, '1730000000000000001', '2025-05-23 10:00:00'),
  R('Titan Anti Habuk Transparent Tempered Glass iPhone 17', 'GlassPro MY', 'RM13.56 - 21.98', '8%', 2052, 29528, 4227, 61000, 54128, 780000, 623, '100%', 2090, 105, '1730000000000000002', '2025-03-29 09:00:00'),
  R('Sarung pelindung hentakan penuh Silikon lutsinar iPhone 17 Pro Max', 'GAGAphonecase', 'RM13.45', '8%', 7116, 130987.51, 40933, 760000, 151645, 2257424, 2007, '50.63%', 4756, 1004, '1730000000000000003', '2025-04-23 05:00:46'),
  R('GOOJODOQ 10,000mAh Bank Kuasa Portable Power Bank', 'GOOJODOQ.Store', 'RM21.97', '8%', 1566, 35494, 3267, 74000, 10456, 236000, 332, '53.01%', 823, 564, '1730000000000000004', '2025-04-27 00:00:00'),
  R('UGREEN PD20W Fast Charger Pengecas Pantas dengan Set Kabel', 'UgreenOfficialShop', 'RM35.68 - 90.90', '6%', 3480, 113289, 13723, 446000, 362874, 11800000, 6637, '100%', 15491, 8952, '1730000000000000005', '2023-06-06 00:00:00'),
  R('【199 Speed】Ultra Mini Turbo Handheld Fan USB Rechargeable', 'HomeMax Borong', 'RM5.49 - 18.60', '10%', 4602, 26192, 16862, 96000, 167718, 955000, 4380, '63.96%', 11303, 3501, '1730000000000000006', '2025-06-21 00:00:00'),
  R('Tali anti-hilang untuk fon telinga Bluetooth', 'XYY 3CHOTSALE', 'RM90.67', '-', 2118, 199098, 10205, 925000, 15335, 1390000, 3, '-', 3, 0, '1730000000000000007', '2025-09-16 00:00:00'),
  R('Four-corner anti-drop case with lanyard for iPhone 17', 'HG.CASE', 'RM11.40', '8%', 1484, 16281, 5594, 61400, 58272, 640000, 1072, '100%', 3056, 402, '1730000000000000008', '2025-04-07 00:00:00'),
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => String.fromCharCode(65 + (i % 26)).padStart(i >= 26 ? 2 : 1, 'A');
function sheetXml(rows) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${ci >= 26 ? 'A' + String.fromCharCode(65 + ci - 26) : String.fromCharCode(65 + ci)}${ri + 1}`;
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

async function build(file, rows, sheet = 'FastMoss') {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', sheetXml(rows));
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

if (require.main === module) build(path.join(__dirname, 'fastmoss-my-3c.xlsx'), [HEAD, ...ROWS]).then(() => console.log('ok'));
module.exports = { build, HEAD, ROWS };
