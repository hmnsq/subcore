/* © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
   SPDX-License-Identifier: GPL-3.0-or-later
   The same function in C: the probe's control, showing what BURP does with a language it reads. */
#include <stdio.h>

static const int LIMIT = 100;

int sum_to(int count) {
    int total = 0;
    for (int index = 1; index <= count && index <= LIMIT; index++) {
        total += index; /* add the next integer */
    }
    return total;
}

int main(void) {
    printf("%d\n", sum_to(10));
    return 0;
}
