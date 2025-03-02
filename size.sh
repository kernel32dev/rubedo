#!/bin/bash
#this script prints some statistics about the bundle size of the main file
TF=temp-no-way-to-conflict.index.min.js
npx minify index.js > $TF
printf "index.js:        %6d (%d lines)\n" $(wc -c < index.js) $(wc -l < index.js)
printf "index.min.js:    %6d\n" $(wc -c < $TF)
printf "index.min.js.gz: %6d\n" $(gzip -c $TF | wc -c)
rm -f $TF
