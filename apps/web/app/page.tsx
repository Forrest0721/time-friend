import { hasConfiguredApi } from "./api-client";
import ConnectedApp from "./connected-app";
import DemoApp from "./demo-app";

export default function Home() {
  return hasConfiguredApi ? <ConnectedApp /> : <DemoApp />;
}
