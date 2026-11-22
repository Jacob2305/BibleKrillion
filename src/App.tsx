import { Suspense, lazy } from "react";
import { usePath, Link } from "./lib/router";
import Home from "./screens/Home";
import Practice from "./screens/Practice";
import Daily from "./screens/Daily";
import Join from "./screens/Join";
import { Dove } from "./game/pixel";
import { SkyPage } from "./game/Sky";

// Host and projector screens are only needed by the person running an event.
const Host = lazy(() => import("./screens/Host"));
const Screen = lazy(() => import("./screens/Screen"));
const Review = lazy(() => import("./screens/Review"));
const ClimbPreview = lazy(() => import("./screens/ClimbPreview"));

export default function App() {
  const path = usePath().replace(/\/+$/, "") || "/";
  switch (path) {
    case "/":
      return <Home />;
    case "/practice":
      return <Practice />;
    case "/daily":
      return <Daily />;
    case "/join":
      return <Join />;
    case "/host":
      return (
        <Suspense fallback={null}>
          <Host />
        </Suspense>
      );
    case "/review":
      return (
        <Suspense fallback={null}>
          <Review />
        </Suspense>
      );
    case "/screen":
      return (
        <Suspense fallback={null}>
          <Screen />
        </Suspense>
      );
    case "/dev/climb":
      if (!import.meta.env.DEV) return <NotFound />;
      return (
        <Suspense fallback={null}>
          <ClimbPreview />
        </Suspense>
      );
    default:
      return <NotFound />;
  }
}

function NotFound() {
  return (
    <SkyPage>
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <Dove className="w-20 animate-bob" />
      <h1 className="text-2xl font-bold">Nothing up here</h1>
      <Link href="/" className="text-sun-300 underline underline-offset-4">
        Back to the ground
      </Link>
    </main>
    </SkyPage>
  );
}
