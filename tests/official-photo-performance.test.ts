import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { parseOfficialPhotoHtml } from "../src/providers/official-photo";

it("preserves quoted angle brackets and tightly joined valid attribute values", () => {
  const result = parseOfficialPhotoHtml(
    `<title data-age="Under < five">Acorn Play Fleet</title><meta property="og:image"content="/interior.jpg"><meta property="og:image:alt" content="Play area interior for ages < 5">`,
    "https://venue.org/",
    { name: "Acorn Play", area: "Fleet", lat: 51.3, lng: -0.8 },
    { websitePreview: true },
  );
  expect(result.candidates.map((image) => image.url)).toEqual([
    "https://venue.org/interior.jpg",
  ]);
});

// A blocked synchronous parser also blocks the provider's async deadline. Run
// worst-case publisher markup in a child so a regression cannot hang Vitest.
const program = `
import {loadProvider} from './scripts/lib/provider-loader.mjs';
const {parseOfficialPhotoHtml}=loadProvider('src/providers/official-photo.ts');
const kind=process.argv[1];
const lead='<title>Acorn Play Fleet</title>';
const fixtures={
  attribute:lead+'<img '+'a'.repeat(100000)+'>',
  title:lead+'<title>'.repeat(71500),
  script:lead+'<script>'.repeat(62500),
  stylesheet:lead+'<style>@font-face{font-family:foo;src:url(data:font/woff2;base64,'+'A'.repeat(100000)+')} .hero{background-image:url(https://venue.org/interior.jpg)}</style>',
};
const result=parseOfficialPhotoHtml(fixtures[kind],'https://venue.org/',{
  name:'Acorn Play',area:'Fleet',lat:51.3,lng:-0.8
},{websitePreview:true,collectReviewCandidates:true});
console.log(JSON.stringify({candidates:result.candidates.map(image=>image.url)}));
`;

it.each(["attribute", "title", "script", "stylesheet"])(
  "keeps publisher %s markup within the synchronous processing bound",
  (kind) => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", program, kind],
      { cwd: process.cwd(), encoding: "utf8", timeout: 4000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).candidates).toEqual(
      kind === "stylesheet" ? ["https://venue.org/interior.jpg"] : [],
    );
  },
);
