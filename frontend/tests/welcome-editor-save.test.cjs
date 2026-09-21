const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const playerConsole = fs.readFileSync(path.join(__dirname, '../src/components/PlayerConsole.vue'), 'utf8');
const brandingService = fs.readFileSync(path.join(__dirname, '../src/services/system-branding.service.ts'), 'utf8');
const welcomePage = fs.readFileSync(path.join(__dirname, '../public/welcome/index.html'), 'utf8');
const designTokens = fs.readFileSync(path.join(__dirname, '../src/styles/design-tokens.css'), 'utf8');

test('welcome editor separates draft saving from publishing and carries the opened revision', () => {
  assert.match(playerConsole, /ensureAdmin\('保存欢迎方案'\)/);
  assert.match(playerConsole, /saveWelcomeSchemes\([\s\S]*welcomeSchemesRevision\.value/);
  assert.match(playerConsole, /已保存到服务器方案库/);
  assert.match(playerConsole, /const confirmed = await fetchWelcomeSchemes\(\)/);
  assert.match(playerConsole, /confirmed\.checksum !== saved\.checksum/);
  assert.match(playerConsole, /仅保存方案/);
  assert.match(playerConsole, /保存并发布到 LED/);
  assert.match(playerConsole, /ensureAdmin\('发布欢迎页'\)/);
  assert.match(playerConsole, /publishWelcomeScheme\(selectedId, welcomeSchemesRevision\.value\)/);
  assert.match(playerConsole, /服务器未确认发布结果/);
  assert.match(playerConsole, /发布到 LED 大屏/);
});

test('welcome editor uploads logo and background in place and remains scrollable on iPhone', () => {
  assert.match(playerConsole, /welcomeLogoUploadInput/);
  assert.match(playerConsole, /welcomeBgUploadInput/);
  assert.match(playerConsole, /mediaService\.upload\(uploadFile/);
  assert.match(playerConsole, /welcomeLogoMediaId/);
  assert.match(playerConsole, /ElScrollbar class="we-scroll" always/);
  assert.match(playerConsole, /class="we-upload-row"/);
  assert.match(playerConsole, /height: 100dvh/);
  assert.match(playerConsole, /\.pick-box\.we-box/);
  assert.match(playerConsole, /\.el-scrollbar__thumb/);
  assert.match(playerConsole, /touch-action: pan-y/);
  assert.match(welcomePage, /id="logoImg"/);
  assert.match(welcomePage, /welcomeLogoUrl/);
});

test('welcome editor keeps uploaded logos and backgrounds in separate libraries and lets admins delete them', () => {
  assert.match(playerConsole, /const logoAssets = ref<WelcomeImageAsset\[]>\(\[]\)/);
  assert.match(playerConsole, /classifyWelcomeImageAssets\(assets, snapshot\.config\.schemes\)/);
  assert.match(playerConsole, /addWelcomeImageAsset\(/);
  assert.match(playerConsole, /removeWelcomeAsset\(asset\.id, welcomeSchemesRevision\.value\)/);
  assert.match(playerConsole, /deleteWelcomeImage\('logo', a\)/);
  assert.match(playerConsole, /deleteWelcomeImage\('background', a\)/);
  assert.match(playerConsole, /modalClass: 'welcome-image-delete-confirm'/);
  assert.match(designTokens, /\.el-overlay\.welcome-image-delete-confirm\s*\{[\s\S]*z-index:\s*4000\s*!important/);
  assert.doesNotMatch(playerConsole, /v-for="a in imageAssets"/);
});

test('welcome editor reopens the last edited saved scheme instead of hiding it behind the published scheme', () => {
  assert.match(playerConsole, /LAST_WELCOME_SCHEME_KEY/);
  assert.match(playerConsole, /const preferredId = selectedWelcomeSchemeId\.value \|\| rememberedWelcomeSchemeId\(\)/);
  assert.match(playerConsole, /snapshot\.config\.schemes\.some\(\(item\) => item\.id === preferredId\)/);
  assert.match(playerConsole, /rememberWelcomeSchemeId\(id\)/);
});

test('welcome schemes save their presentation and the live renderer applies the same bounded options', () => {
  assert.match(brandingService, /export interface WelcomePresentation/);
  assert.match(brandingService, /version:\s*2/);
  assert.match(playerConsole, /welcomeLayoutOptions/);
  assert.match(playerConsole, /updateWelcomePresentation\('layout'/);
  assert.match(playerConsole, /welcomePresentation:\s*cloneWelcomePresentation/);
  assert.match(playerConsole, /JSON\.stringify\(published\.branding\.welcomePresentation\)/);
  assert.match(welcomePage, /function applyPresentation\(input\)/);
  assert.match(welcomePage, /document\.body\.dataset\.layout/);
  assert.match(welcomePage, /body\[data-layout="editorial"\]/);
  assert.match(welcomePage, /body\[data-layout="minimal"\]/);
});

test('logo selection uses fresh authorized image URLs and an explicit state transition', () => {
  assert.match(playerConsole, /const access = await mediaService\.access\(asset\.id\)/);
  assert.match(playerConsole, /function selectWelcomeLogo\(mediaId: number \| null\)/);
  assert.match(playerConsole, /@click="selectWelcomeLogo\(a\.id\)"/);
  assert.match(playerConsole, /welcomeForm\.value = chooseWelcomeLogo\(welcomeForm\.value, mediaId\)/);
  assert.match(playerConsole, /welcomeAssetUploading \|\| welcomeAssetDeletingId/);
});

test('welcome editor converts every new or legacy background before selection', () => {
  assert.match(playerConsole, /normalizeWelcomeBackground\(file\)/);
  assert.match(playerConsole, /selectWelcomeBackground\(a\)/);
  assert.match(playerConsole, /旧底图已转换为 LED 原生尺寸并选中/);
  assert.doesNotMatch(playerConsole, /:disabled="a\.resolution\?\.toLowerCase\(\) !== LED_CANVAS_RESOLUTION"/);
});

test('welcome save contract documents its administrator boundary', () => {
  assert.match(brandingService, /后端仍要求管理员身份/);
  assert.match(brandingService, /expectedRevision/);
  assert.doesNotMatch(brandingService, /客户端 token 即可/);
});


test('welcome venue/org lines are editable, hideable, and published; title offers five effects', () => {
  // editor state: four display text inputs + per-line hide checkbox + three-state helpers
  assert.match(playerConsole, /const welcomeHidden = reactive\(/);
  assert.match(playerConsole, /function welcomeDisplayValue\(/);
  assert.match(playerConsole, /function applyWelcomeDisplay\(/);
  assert.match(playerConsole, /class="wb-display-row"/);
  assert.match(playerConsole, /场馆中文名/);
  assert.match(playerConsole, /落款单位一/);
  assert.match(playerConsole, /v-model="welcomeHidden\.venue"/);
  assert.match(playerConsole, /:disabled="welcomeHidden\.venue"/);
  assert.match(playerConsole, /watch\(welcomeHidden, pushWelcomePreview/);
  // title effect picker wired through the generic presentation update
  assert.match(playerConsole, /const welcomeTitleEffectOptions = \[/);
  assert.match(playerConsole, /updateWelcomePresentation\('titleEffect', option\.value\)/);
  // hidden/custom/default rides the publish verification comparison
  assert.match(playerConsole, /published\.branding\.welcomeVenue === selected\.welcomeVenue/);
  assert.match(playerConsole, /published\.branding\.welcomeOrg2 === selected\.welcomeOrg2/);
  // service contract exposes the enum and the new nullable display fields
  assert.match(brandingService, /WelcomeTitleEffect/);
  assert.match(brandingService, /titleEffect\??:/);
  assert.match(brandingService, /welcomeVenue\??: string \| null/);
});

test('LED welcome renderer hides or defaults venue/org lines and ships five title effects', () => {
  // editable line ids + three-state render helpers
  assert.match(welcomePage, /id="venueName"/);
  assert.match(welcomePage, /id="venueEnName"/);
  assert.match(welcomePage, /id="orgName1"/);
  assert.match(welcomePage, /id="orgName2"/);
  assert.match(welcomePage, /const displayText = \(value, fallback\)/);
  assert.match(welcomePage, /const setLine = \(id, text\)/);
  assert.match(welcomePage, /DEFAULT_VENUE_CN/);
  // organizer dot/separator only render when both bylines are visible
  assert.match(welcomePage, /id="orgDotBefore"/);
  assert.match(welcomePage, /id="orgDotAfter"/);
  // effect applied to <body> and one CSS block per effect, placed after tone rules
  assert.match(welcomePage, /document\.body\.dataset\.titleEffect = safe\.titleEffect/);
  assert.match(welcomePage, /body\[data-title-effect="blue"\]/);
  assert.match(welcomePage, /body\[data-title-effect="gold"\]/);
  assert.match(welcomePage, /body\[data-title-effect="white"\]/);
  assert.match(welcomePage, /body\[data-title-effect="ink"\]/);
  assert.match(welcomePage, /body\[data-title-effect="neon"\]/);
});
