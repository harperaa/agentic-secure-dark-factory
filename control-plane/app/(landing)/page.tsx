import { HeroHeader } from "./header";
import { FloorRedirect } from "./floor-redirect";
// modules:imports

export default function Home() {
  return (
    <div>
      <FloorRedirect />
      <HeroHeader />
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl font-semibold lg:text-5xl">
          {process.env.NEXT_PUBLIC_SITE_NAME || 'Secure Vibe Coding OS'}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-xl">
          Your secure foundation is running. Sign in to get started, or add
          content modules with /add-module.
        </p>
      </main>
      {/* modules:sections */}
    </div>
  );
}
