// Separate storage keeps this scene from inheriting underwater resolution/crash settings.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.astral || '').split(','); bad = localStorage.astralLoad; } catch {}
LV = SV[0] !== '' && SV[0] !== undefined ? clampLevel(+SV[0]) : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
function clampLevel(v) { return Number.isInteger(v) && v >= 0 && v <= 2 ? v : 0; }
if (bad && LV < 2) { SV = [++LV]; keep('astral', LV); }
