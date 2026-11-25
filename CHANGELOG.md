# Changelog

## 0.1.1

- Fix: valid IBANs could trigger a false BR-DE-19 / BR-DE-20 warning. SaxonJS computes
  `xs:integer(...) mod 97` imprecisely above 2^53; the IBAN check now uses `xs:decimal`.
  The verdict (`valid`) was not affected because both rules are warnings, but `warnings`
  differed from the KoSIT Java validator. Found by running invoices generated with
  node-zugferd. Added 8 regression fixtures with several IBANs.

## 0.1.0

- First release: KoSIT XRechnung / EN 16931 validation (XSD + Schematron) in pure JavaScript.
