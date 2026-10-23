- **before**: code pristine HEAD export @890e63123 (0 dirty brain files), 2026-10-21T23:54:47.952Z
- **after**: code working tree @890e63123 (6 dirty brain files), 2026-10-21T23:57:11.490Z

| category | method | run | n | answer in ctx | evidence all | latest-wins strict | latest first | leak q | tokens p50 | ms p50 | ms p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| direct | graphPlusMemories | before | 30 | 33.3% | 30.0% | — | — | 0 | 3818 | 426 | 604 |
| direct | graphPlusMemories | after | 30 | 100.0% | 100.0% | — | — | 0 | 2157 | 44.6 | 52.7 |
| direct | recallGraph | before | 30 | 20.0% | 13.3% | — | — | 0 | 3181 | 279 | 301 |
| direct | recallGraph | after | 30 | 100.0% | 100.0% | — | — | 0 | 1374 | 36.5 | 44.8 |
| direct | recallMemories | before | 30 | 16.7% | 16.7% | — | — | 0 | 637 | 406 | 578 |
| direct | recallMemories | after | 30 | 20.0% | 20.0% | — | — | 0 | 796 | 20.1 | 29.3 |
| direct | studioRecall | before | 30 | 0.0% | 0.0% | — | — | 0 | 0.00 | 9.23 | 13.3 |
| direct | studioRecall | after | 30 | 0.0% | 0.0% | — | — | 0 | 0.00 | 9.41 | 16.0 |
| direct | studioRecallFixCast | before | 30 | 30.0% | 26.7% | — | — | 0 | 813 | 173 | 227 |
| direct | studioRecallFixCast | after | 30 | 20.0% | 20.0% | — | — | 0 | 796 | 22.5 | 26.3 |
| direct | vectorTop10 | before | 30 | 30.0% | 26.7% | — | — | 0 | 814 | 6.56 | 9.10 |
| direct | vectorTop10 | after | 30 | 30.0% | 26.7% | — | — | 0 | 814 | 6.50 | 8.69 |
| join | graphPlusMemories | before | 80 | 18.8% | 7.5% | — | — | 0 | 3713 | 913 | 974 |
| join | graphPlusMemories | after | 80 | 68.8% | 68.8% | — | — | 0 | 1629 | 45.6 | 57.8 |
| join | recallGraph | before | 80 | 7.5% | 5.0% | — | — | 0 | 3207 | 241 | 285 |
| join | recallGraph | after | 80 | 68.8% | 68.8% | — | — | 0 | 1053 | 37.2 | 45.4 |
| join | recallMemories | before | 80 | 12.5% | 0.0% | — | — | 0 | 530 | 894 | 921 |
| join | recallMemories | after | 80 | 8.8% | 0.0% | — | — | 0 | 611 | 35.6 | 42.8 |
| join | studioRecall | before | 80 | 0.0% | 0.0% | — | — | 0 | 0.00 | 10.6 | 13.9 |
| join | studioRecall | after | 80 | 0.0% | 0.0% | — | — | 0 | 0.00 | 9.91 | 14.5 |
| join | studioRecallFixCast | before | 80 | 10.0% | 0.0% | — | — | 0 | 797 | 317 | 334 |
| join | studioRecallFixCast | after | 80 | 8.8% | 0.0% | — | — | 0 | 611 | 39.5 | 45.6 |
| join | vectorTop10 | before | 80 | 10.0% | 0.0% | — | — | 0 | 797 | 6.78 | 8.19 |
| join | vectorTop10 | after | 80 | 10.0% | 0.0% | — | — | 0 | 797 | 6.97 | 8.72 |
| multihop2 | graphPlusMemories | before | 60 | 3.3% | 3.3% | — | — | 0 | 3733 | 657 | 715 |
| multihop2 | graphPlusMemories | after | 60 | 31.7% | 31.7% | — | — | 0 | 1360 | 31.9 | 41.6 |
| multihop2 | recallGraph | before | 60 | 0.0% | 0.0% | — | — | 0 | 3185 | 212 | 278 |
| multihop2 | recallGraph | after | 60 | 30.0% | 30.0% | — | — | 0 | 804 | 23.7 | 33.3 |
| multihop2 | recallMemories | before | 60 | 3.3% | 3.3% | — | — | 0 | 538 | 655 | 690 |
| multihop2 | recallMemories | after | 60 | 5.0% | 3.3% | — | — | 0 | 559 | 25.0 | 33.9 |
| multihop2 | studioRecall | before | 60 | 0.0% | 0.0% | — | — | 0 | 0.00 | 10.3 | 14.9 |
| multihop2 | studioRecall | after | 60 | 0.0% | 0.0% | — | — | 0 | 0.00 | 8.78 | 15.3 |
| multihop2 | studioRecallFixCast | before | 60 | 1.7% | 1.7% | — | — | 0 | 533 | 270 | 285 |
| multihop2 | studioRecallFixCast | after | 60 | 5.0% | 3.3% | — | — | 0 | 559 | 27.5 | 33.3 |
| multihop2 | vectorTop10 | before | 60 | 1.7% | 1.7% | — | — | 0 | 533 | 6.58 | 8.94 |
| multihop2 | vectorTop10 | after | 60 | 1.7% | 1.7% | — | — | 0 | 533 | 6.82 | 9.77 |
| multihop3 | graphPlusMemories | before | 40 | 0.0% | 0.0% | — | — | 0 | 3714 | 996 | 1037 |
| multihop3 | graphPlusMemories | after | 40 | 62.5% | 62.5% | — | — | 0 | 1660 | 48.8 | 53.4 |
| multihop3 | recallGraph | before | 40 | 0.0% | 0.0% | — | — | 0 | 3191 | 223 | 273 |
| multihop3 | recallGraph | after | 40 | 62.5% | 62.5% | — | — | 0 | 1099 | 37.9 | 40.2 |
| multihop3 | recallMemories | before | 40 | 0.0% | 0.0% | — | — | 0 | 529 | 968 | 1011 |
| multihop3 | recallMemories | after | 40 | 0.0% | 0.0% | — | — | 0 | 563 | 39.5 | 46.4 |
| multihop3 | studioRecall | before | 40 | 0.0% | 0.0% | — | — | 0 | 0.00 | 11.6 | 14.5 |
| multihop3 | studioRecall | after | 40 | 0.0% | 0.0% | — | — | 0 | 0.00 | 11.0 | 28.2 |
| multihop3 | studioRecallFixCast | before | 40 | 0.0% | 0.0% | — | — | 0 | 580 | 360 | 372 |
| multihop3 | studioRecallFixCast | after | 40 | 0.0% | 0.0% | — | — | 0 | 557 | 41.8 | 45.2 |
| multihop3 | vectorTop10 | before | 40 | 0.0% | 0.0% | — | — | 0 | 586 | 7.88 | 8.82 |
| multihop3 | vectorTop10 | after | 40 | 0.0% | 0.0% | — | — | 0 | 586 | 8.30 | 10.8 |
| permission | graphPlusMemories | before | 60 | 60.0% | 60.0% | — | — | 60 {"employees-tagged":30,"finance-record-untagged":39,"finance-tagged":18} | 3714 | 442 | 559 |
| permission | graphPlusMemories | after | 60 | 83.3% | 83.3% | — | — | 60 {"finance-record-untagged":47,"employees-tagged":34,"finance-tagged":20} | 1699 | 42.7 | 68.5 |
| permission | recallGraph | before | 60 | 55.0% | 55.0% | — | — | 60 {"employees-tagged":30,"finance-record-untagged":36,"finance-tagged":17} | 3166 | 219 | 275 |
| permission | recallGraph | after | 60 | 66.7% | 66.7% | — | — | 60 {"finance-record-untagged":43,"employees-tagged":34,"finance-tagged":12} | 1178 | 38.7 | 66.8 |
| permission | recallMemories | before | 60 | 56.7% | 56.7% | — | — | 59 {"employees-tagged":29,"finance-record-untagged":27,"finance-tagged":15} | 504 | 425 | 526 |
| permission | recallMemories | after | 60 | 58.3% | 58.3% | — | — | 60 {"employees-tagged":30,"finance-record-untagged":28,"finance-tagged":15} | 510 | 20.8 | 26.5 |
| permission | studioRecall | before | 60 | 0.0% | 0.0% | — | — | 0 | 0.00 | 9.17 | 17.3 |
| permission | studioRecall | after | 60 | 0.0% | 0.0% | — | — | 0 | 0.00 | 8.82 | 11.7 |
| permission | studioRecallFixCast | before | 60 | 3.3% | 3.3% | — | — | 35 {"finance-record-untagged":35} | 595 | 197 | 226 |
| permission | studioRecallFixCast | after | 60 | 1.7% | 1.7% | — | — | 38 {"finance-record-untagged":38} | 588 | 23.6 | 28.4 |
| permission | vectorTop10 | before | 60 | 58.3% | 58.3% | — | — | 54 {"employees-tagged":26,"personal":26,"finance-record-untagged":31,"finance-tagged":10} | 491 | 6.27 | 8.21 |
| permission | vectorTop10 | after | 60 | 58.3% | 58.3% | — | — | 54 {"employees-tagged":26,"personal":25,"finance-record-untagged":31,"finance-tagged":10} | 491 | 6.47 | 9.56 |
| permission_finance | graphPlusMemories | before | 60 | 60.0% | 60.0% | — | — | 30 {"employees-tagged":30} | 3714 | 447 | 554 |
| permission_finance | graphPlusMemories | after | 60 | 83.3% | 83.3% | — | — | 34 {"employees-tagged":34} | 1699 | 43.6 | 69.2 |
| permission_finance | recallGraph | before | 60 | 55.0% | 55.0% | — | — | 30 {"employees-tagged":30} | 3166 | 229 | 292 |
| permission_finance | recallGraph | after | 60 | 66.7% | 66.7% | — | — | 34 {"employees-tagged":34} | 1178 | 38.7 | 63.9 |
| permission_finance | recallMemories | before | 60 | 56.7% | 56.7% | — | — | 29 {"employees-tagged":29} | 504 | 420 | 527 |
| permission_finance | recallMemories | after | 60 | 58.3% | 58.3% | — | — | 30 {"employees-tagged":30} | 510 | 20.4 | 25.4 |
| permission_finance | studioRecall | before | 60 | 0.0% | 0.0% | — | — | 0 | 0.00 | 7.38 | 9.02 |
| permission_finance | studioRecall | after | 60 | 0.0% | 0.0% | — | — | 0 | 0.00 | 8.49 | 9.59 |
| permission_finance | studioRecallFixCast | before | 60 | 20.0% | 20.0% | — | — | 0 | 583 | 198 | 225 |
| permission_finance | studioRecallFixCast | after | 60 | 26.7% | 26.7% | — | — | 0 | 573 | 23.7 | 28.0 |
| permission_finance | vectorTop10 | before | 60 | 58.3% | 58.3% | — | — | 28 {"employees-tagged":26,"personal":26} | 491 | 5.53 | 6.93 |
| permission_finance | vectorTop10 | after | 60 | 58.3% | 58.3% | — | — | 28 {"employees-tagged":26,"personal":25} | 491 | 5.68 | 7.29 |
| permission_owner | graphPlusMemories | before | 60 | 76.7% | 76.7% | — | — | 0 | 3687 | 455 | 567 |
| permission_owner | graphPlusMemories | after | 60 | 100.0% | 100.0% | — | — | 0 | 1701 | 43.7 | 70.7 |
| permission_owner | recallGraph | before | 60 | 71.7% | 71.7% | — | — | 0 | 3165 | 225 | 288 |
| permission_owner | recallGraph | after | 60 | 83.3% | 83.3% | — | — | 0 | 1178 | 38.8 | 64.1 |
| permission_owner | recallMemories | before | 60 | 70.0% | 70.0% | — | — | 0 | 484 | 425 | 528 |
| permission_owner | recallMemories | after | 60 | 76.7% | 76.7% | — | — | 0 | 494 | 21.3 | 24.0 |
| permission_owner | studioRecall | before | 60 | 0.0% | 0.0% | — | — | 0 | 0.00 | 7.80 | 9.97 |
| permission_owner | studioRecall | after | 60 | 0.0% | 0.0% | — | — | 0 | 0.00 | 8.50 | 9.90 |
| permission_owner | studioRecallFixCast | before | 60 | 58.3% | 58.3% | — | — | 0 | 500 | 200 | 227 |
| permission_owner | studioRecallFixCast | after | 60 | 76.7% | 76.7% | — | — | 0 | 494 | 24.8 | 28.6 |
| permission_owner | vectorTop10 | before | 60 | 58.3% | 58.3% | — | — | 0 | 491 | 5.87 | 7.16 |
| permission_owner | vectorTop10 | after | 60 | 58.3% | 58.3% | — | — | 0 | 491 | 6.09 | 8.26 |
| sweep_sales | graphPlusMemories | before | 310 | 40.3% | 37.1% | — | 21.0% | 189 {"employees-tagged":37,"finance-record-untagged":163,"finance-tagged":3} | 3790 | 632 | 994 |
| sweep_sales | graphPlusMemories | after | 310 | 73.9% | 73.9% | — | 16.1% | 275 {"finance-record-untagged":275} | 1700 | 43.4 | 52.5 |
| sweep_sales | recallGraph | before | 310 | 21.0% | 18.7% | — | 16.8% | 176 {"employees-tagged":37,"finance-record-untagged":146,"finance-tagged":3} | 3195 | 231 | 290 |
| sweep_sales | recallGraph | after | 310 | 73.5% | 73.5% | — | 16.1% | 274 {"finance-record-untagged":274} | 1043 | 36.2 | 46.2 |
| sweep_sales | recallMemories | before | 310 | 33.2% | 30.0% | — | 14.8% | 43 {"finance-record-untagged":43} | 560 | 610 | 967 |
| sweep_sales | recallMemories | after | 310 | 31.9% | 29.4% | — | 16.5% | 21 {"finance-record-untagged":21} | 661 | 24.8 | 41.8 |
| sweep_sales | studioRecall | before | 310 | 0.0% | 0.0% | — | 0.0% | 0 | 0.00 | 8.20 | 11.0 |
| sweep_sales | studioRecall | after | 310 | 0.0% | 0.0% | — | 0.0% | 0 | 0.00 | 8.62 | 12.2 |
| sweep_sales | studioRecallFixCast | before | 310 | 31.0% | 28.1% | — | 11.3% | 23 {"finance-record-untagged":23} | 601 | 241 | 359 |
| sweep_sales | studioRecallFixCast | after | 310 | 31.9% | 29.4% | — | 16.8% | 21 {"finance-record-untagged":21} | 643 | 27.5 | 43.9 |
| sweep_sales | vectorTop10 | before | 310 | 31.0% | 28.1% | — | 11.3% | 20 {"finance-record-untagged":20} | 606 | 6.11 | 8.14 |
| sweep_sales | vectorTop10 | after | 310 | 31.0% | 28.1% | — | 11.3% | 20 {"finance-record-untagged":20} | 606 | 6.21 | 8.14 |
| temporal | graphPlusMemories | before | 50 | 96.0% | 96.0% | — | 30.0% | 0 | 3943 | 627 | 698 |
| temporal | graphPlusMemories | after | 50 | 100.0% | 100.0% | — | 48.0% | 0 | 1766 | 44.7 | 56.7 |
| temporal | recallGraph | before | 50 | 6.0% | 0.0% | — | 4.0% | 0 | 3184 | 216 | 291 |
| temporal | recallGraph | after | 50 | 100.0% | 100.0% | — | 48.0% | 0 | 991 | 38.6 | 55.0 |
| temporal | recallMemories | before | 50 | 96.0% | 96.0% | — | 28.0% | 0 | 773 | 603 | 644 |
| temporal | recallMemories | after | 50 | 96.0% | 96.0% | — | 46.0% | 0 | 768 | 23.9 | 32.3 |
| temporal | studioRecall | before | 50 | 0.0% | 0.0% | — | 0.0% | 0 | 0.00 | 9.99 | 16.0 |
| temporal | studioRecall | after | 50 | 0.0% | 0.0% | — | 0.0% | 0 | 0.00 | 9.57 | 12.8 |
| temporal | studioRecallFixCast | before | 50 | 94.0% | 94.0% | — | 48.0% | 0 | 776 | 245 | 257 |
| temporal | studioRecallFixCast | after | 50 | 96.0% | 96.0% | — | 48.0% | 0 | 766 | 26.8 | 34.6 |
| temporal | vectorTop10 | before | 50 | 94.0% | 94.0% | — | 48.0% | 0 | 776 | 6.63 | 8.35 |
| temporal | vectorTop10 | after | 50 | 94.0% | 94.0% | — | 48.0% | 0 | 776 | 6.94 | 10.1 |
| update_conversation | graphPlusMemories | before | 25 | 100.0% | 100.0% | 0.0% | 100.0% | 0 | 3737 | 503 | 580 |
| update_conversation | graphPlusMemories | after | 25 | 100.0% | 100.0% | 0.0% | 4.0% | 0 | 1713 | 36.7 | 41.1 |
| update_conversation | recallGraph | before | 25 | 100.0% | 100.0% | 44.0% | 100.0% | 0 | 3169 | 206 | 268 |
| update_conversation | recallGraph | after | 25 | 100.0% | 100.0% | 0.0% | 4.0% | 0 | 1068 | 29.7 | 36.7 |
| update_conversation | recallMemories | before | 25 | 92.0% | 92.0% | 0.0% | 64.0% | 0 | 551 | 476 | 545 |
| update_conversation | recallMemories | after | 25 | 96.0% | 96.0% | 4.0% | 68.0% | 0 | 664 | 24.4 | 32.1 |
| update_conversation | studioRecall | before | 25 | 0.0% | 0.0% | 0.0% | 0.0% | 0 | 0.00 | 9.07 | 11.1 |
| update_conversation | studioRecall | after | 25 | 0.0% | 0.0% | 0.0% | 0.0% | 0 | 0.00 | 9.27 | 13.2 |
| update_conversation | studioRecallFixCast | before | 25 | 84.0% | 84.0% | 0.0% | 4.0% | 0 | 441 | 203 | 222 |
| update_conversation | studioRecallFixCast | after | 25 | 96.0% | 96.0% | 4.0% | 68.0% | 0 | 612 | 24.9 | 28.3 |
| update_conversation | vectorTop10 | before | 25 | 84.0% | 84.0% | 0.0% | 4.0% | 0 | 493 | 6.06 | 10.3 |
| update_conversation | vectorTop10 | after | 25 | 84.0% | 84.0% | 0.0% | 4.0% | 0 | 493 | 6.34 | 8.21 |
| update_record | graphPlusMemories | before | 25 | 100.0% | 100.0% | 40.0% | 100.0% | 0 | 5259 | 643 | 690 |
| update_record | graphPlusMemories | after | 25 | 100.0% | 100.0% | 56.0% | 100.0% | 0 | 2361 | 43.7 | 65.2 |
| update_record | recallGraph | before | 25 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 3256 | 258 | 283 |
| update_record | recallGraph | after | 25 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 1016 | 33.2 | 43.9 |
| update_record | recallMemories | before | 25 | 60.0% | 60.0% | 0.0% | 60.0% | 0 | 2017 | 629 | 656 |
| update_record | recallMemories | after | 25 | 44.0% | 44.0% | 0.0% | 44.0% | 0 | 1337 | 27.0 | 31.7 |
| update_record | studioRecall | before | 25 | 0.0% | 0.0% | 0.0% | 0.0% | 0 | 0.00 | 10.3 | 18.8 |
| update_record | studioRecall | after | 25 | 0.0% | 0.0% | 0.0% | 0.0% | 0 | 0.00 | 8.87 | 13.4 |
| update_record | studioRecallFixCast | before | 25 | 40.0% | 40.0% | 40.0% | 40.0% | 0 | 835 | 234 | 262 |
| update_record | studioRecallFixCast | after | 25 | 44.0% | 44.0% | 44.0% | 44.0% | 0 | 848 | 26.3 | 28.3 |
| update_record | vectorTop10 | before | 25 | 40.0% | 40.0% | 40.0% | 40.0% | 0 | 835 | 6.21 | 7.99 |
| update_record | vectorTop10 | after | 25 | 40.0% | 40.0% | 40.0% | 40.0% | 0 | 835 | 6.37 | 25.1 |

| method | run | functional n | answer in ctx | evidence all | tokens p50 | tokens p95 | ms p50 | ms p95 | leak q (sales) |
|---|---|---|---|---|---|---|---|---|---|
| graphPlusMemories | before | 310 | 40.3% | 37.1% | 3790 | 5232 | 635 | 1002 | 249/370 |
| graphPlusMemories | after | 310 | 73.9% | 73.9% | 1700 | 2374 | 43.4 | 55.2 | 335/370 |
| recallGraph | before | 310 | 21.0% | 18.7% | 3195 | 3277 | 225 | 291 | 236/370 |
| recallGraph | after | 310 | 73.5% | 73.5% | 1043 | 1383 | 36.0 | 45.5 | 334/370 |
| recallMemories | before | 310 | 33.2% | 30.0% | 560 | 2004 | 610 | 971 | 102/370 |
| recallMemories | after | 310 | 31.9% | 29.4% | 661 | 995 | 25.7 | 42.8 | 81/370 |
| studioRecall | before | 310 | 0.0% | 0.0% | 0.00 | 0.00 | 10.3 | 14.5 | 0/370 |
| studioRecall | after | 310 | 0.0% | 0.0% | 0.00 | 0.00 | 9.70 | 16.0 | 0/370 |
| studioRecallFixCast | before | 310 | 31.0% | 28.1% | 601 | 839 | 244 | 362 | 58/370 |
| studioRecallFixCast | after | 310 | 31.9% | 29.4% | 643 | 839 | 27.0 | 44.4 | 59/370 |
| vectorTop10 | before | 310 | 31.0% | 28.1% | 606 | 839 | 6.73 | 8.82 | 74/370 |
| vectorTop10 | after | 310 | 31.0% | 28.1% | 606 | 839 | 6.94 | 10.0 | 74/370 |
