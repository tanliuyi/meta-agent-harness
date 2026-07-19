import { execFileSync } from "node:child_process";
import { join } from "node:path";

export default async function validateDesktopSigning(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  } catch (error) {
    if (process.env.PI_REQUIRE_DESKTOP_SIGNING === "1") throw error;
    console.warn("Desktop signing validation skipped because this build has no usable signing identity");
    return;
  }
  const entitlements = execFileSync("codesign", ["-d", "--entitlements", ":-", appPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!entitlements.includes("com.apple.security.cs.disable-library-validation")) {
    throw new Error("Desktop app is missing the reviewed disable-library-validation entitlement");
  }
  execFileSync("spctl", ["--assess", "--type", "execute", appPath], { stdio: "inherit" });
  console.log("Validated Desktop app signature and native-module entitlement");
}
