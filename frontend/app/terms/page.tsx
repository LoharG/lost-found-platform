import type { Metadata } from "next";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Terms of Use" };

// DRAFT: must be reviewed by the owner and legal counsel before launch.
export default function TermsPage() {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4 leading-relaxed">
      <h1 className="text-3xl font-bold">Terms of Use</h1>
      <Alert tone="warn">Draft for owner and legal review. Sections marked [REVIEW] need confirmation before launch.</Alert>

      <h2 className="mt-4 text-xl font-semibold">The service</h2>
      <p>
        Lost &amp; Found helps people post lost and found items and contact each other privately. We do not hold, ship or verify items and are not a party to
        any hand-over.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Your responsibilities</h2>
      <ul className="list-disc pl-6">
        <li>Post only genuine lost or found items. No advertising, sales or spam.</li>
        <li>Do not post other people&apos;s personal information, ID numbers or card numbers in listings or photos.</li>
        <li>Never ask for or send payment before an item is handed over. Meet in a public place.</li>
        <li>Hand found documents, IDs and valuables to the police where the law requires it. [REVIEW: local legal obligations]</li>
      </ul>

      <h2 className="mt-4 text-xl font-semibold">Moderation</h2>
      <p>
        Anyone can report a listing. Moderators may remove listings that break these terms; every decision is recorded with a reason. The poster is notified
        and can see the removed listing. [REVIEW: appeal process and contact.]
      </p>

      <h2 className="mt-4 text-xl font-semibold">Liability</h2>
      <p>[REVIEW: limitation of liability, governing law and jurisdiction.]</p>
    </article>
  );
}
