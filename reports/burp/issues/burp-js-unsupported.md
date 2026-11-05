<!-- © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC-BY-SA-4.0 -->

# BURP does not read JavaScript: .js and .mjs are copied, not ingested

BURP version: BURP 2026.10.1

What happens: `burp check` and `burp ingest` copy every `.js` and `.mjs` file unchanged. burp.py lists both suffixes in `UNSUPPORTED` (src/burp_ilm/burp/burp.py, line 364 at commit 888778fa34e1540347c2d8b8a763b88da9c937b1) and `ingest_one` copies such files with `shutil.copy2`, counting them under "files in languages BURP cannot read yet". The reverse then returns them byte for byte, so `burp check` reports success, but no keyword, identifier or comment of the JavaScript is put into the language.

Reproduce:

```
burp check tests/burp/minimal-esm --langs arabic,aramaic,assamese,awadhi,balinese,balochi,batak,bengali,bhojpuri,bodo,buginese,bulgarian,burmese,chhattisgarhi,chinese,dari,dogri,dzongkha,gujarati,hausa_ajami,hebrew,hindi,japanese,javanese,kannada,kashmiri,kashmiri_dev,khmer,konkani,korean,kurdish_sorani,lao,lepcha,limbu,magahi,maithili,malay_jawi,malayalam,mandaic,manipuri_beng,marathi,marwari,nabataean,nepali,newari,odia,pali,pashto,persian,phoenician,prakrit,punjabi,punjabi_shahmukhi,rajasthani,russian,samaritan,sanskrit,santali,saraiki,serbian,shan,sindhi,sindhi_dev,sinhala,sundanese,syriac,tagalog,tamil,telugu,thai,tibetan,tulu,ukrainian,urdu,uyghur,vietnamese --translators glossary --out .cache/tmp/burp/minimal-esm --json .cache/tmp/burp/minimal-esm.json --jobs 3
```

Exit code: 0

Output (tail):

```

prakrit                      LATIN           2/2      
punjabi                      LATIN           2/2      
punjabi_shahmukhi            LATIN           2/2      
rajasthani                   LATIN           2/2      
russian                      LATIN           2/2      
samaritan                    LATIN           2/2      
sanskrit                     LATIN           2/2      
santali                      LATIN           2/2      
saraiki                      LATIN           2/2      
serbian                      LATIN           2/2      
shan                         LATIN           2/2      
sindhi                       LATIN           2/2      
sindhi_dev                   LATIN           2/2      
sinhala                      LATIN           2/2      
sundanese                    LATIN           2/2      
syriac                       LATIN           2/2      
tagalog                      LATIN           2/2      
tamil                        LATIN           2/2      
telugu                       LATIN           2/2      
thai                         LATIN           2/2      
tibetan                      LATIN           2/2      
tulu                         LATIN           2/2      
ukrainian                    LATIN           2/2      
urdu                         LATIN           2/2      
uyghur                       LATIN           2/2      
vietnamese                   LATIN           2/2      

burp check: 76 ingestions, 76 reverse to the original byte for byte


```

Subjects affected (11): minimal-esm, mathjs, js-yaml, uplot, three, jscad-modeling, planck, quantum-circuit, quirk, subcore-src, subcore-tools.

Example, language arabic: {"state": "exact_copied", "files": 2, "exact": 2, "localised": 0, "copied": 2, "js_files": 2, "js_localised": 0, "unsupported": {".js": 1, ".mjs": 1}, "differ": []}

The control (tests/burp/control-c, the same function in C) is localised in the same run, which shows the probe sees localisation where BURP reads the language.

Asked of BURP's next round: a JavaScript paradigm (ECMAScript 2020 modules: keywords, template literals, regular-expression literals, `//` and `/* */` comments, import and export names kept as externals when they name another module's exports), with the byte-for-byte reverse that the other paradigms have.
