declare module "virtual:assets" {
  const assets: Record<string, { body: string; type: string }>;
  export default assets;
}
