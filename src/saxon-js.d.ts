// Minimale Typen für saxon-js (das Paket bringt keine mit)
declare module "saxon-js" {
  interface TransformOptions {
    stylesheetInternal: unknown;
    sourceText: string;
    destination: "serialized";
  }
  interface TransformResult {
    principalResult: unknown;
  }
  const SaxonJS: {
    transform(options: TransformOptions, mode: "sync"): TransformResult;
  };
  export default SaxonJS;
}
