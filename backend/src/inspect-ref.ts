import { chromium } from "playwright";

const url = process.argv[2] ?? "https://warden-dashboard-olive.vercel.app/";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
  await page.waitForTimeout(1200);

  const palette = await page.evaluate(`(function(){
    var bg = {}, fg = {}, fonts = {};
    function bump(o, v){ if(!v || v === "rgba(0, 0, 0, 0)" || v === "transparent") return; o[v] = (o[v]||0)+1; }
    var els = Array.prototype.slice.call(document.querySelectorAll("*"), 0, 4000);
    for (var i=0;i<els.length;i++){ var cs = getComputedStyle(els[i]); bump(bg, cs.backgroundColor); bump(fg, cs.color); bump(fonts, cs.fontFamily); }
    function top(o, n){ return Object.keys(o).map(function(k){return [k,o[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,n||8).map(function(e){return e[0]+"  ("+e[1]+")";}); }
    var btn = document.querySelector("button, a[class*='btn'], [role='button']");
    var h1 = document.querySelector("h1");
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      bodyFont: getComputedStyle(document.body).fontFamily,
      h1Font: h1 ? getComputedStyle(h1).fontFamily : null,
      h1Size: h1 ? getComputedStyle(h1).fontSize : null,
      h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
      backgrounds: top(bg),
      textColors: top(fg),
      fontFamilies: top(fonts, 6),
      button: btn ? { bg: getComputedStyle(btn).backgroundColor, color: getComputedStyle(btn).color, radius: getComputedStyle(btn).borderRadius, border: getComputedStyle(btn).border } : null,
      bodyText: document.body.innerText.replace(/\\n{2,}/g, "\\n").slice(0, 600)
    };
  })()`);

  console.log(JSON.stringify(palette, null, 2));
} catch (e) {
  console.error("inspect failed:", (e as Error).message);
} finally {
  await ctx.close();
  await browser.close();
}
