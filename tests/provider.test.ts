import { describe, it, expect } from "vitest";
import { detectProvider, type ProviderConfig } from "../src/email/provider.js";

// ---------------------------------------------------------------------------
// Helper — 기본 config (모두 null)
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: null,
    resendKey: null,
    smtpPass: null,
    smtpHost: null,
    smtpPort: null,
    smtpUser: null,
    email: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectProvider 테스트
// ---------------------------------------------------------------------------

describe("detectProvider", () => {
  it("설정 없으면 'none' 반환", () => {
    expect(detectProvider(makeConfig())).toBe("none");
  });

  it("resend_key만 있으면 'resend' 자동 감지", () => {
    expect(detectProvider(makeConfig({ resendKey: "re_test_123" }))).toBe("resend");
  });

  it("smtp_pass만 있으면 'gmail_smtp' 자동 감지", () => {
    expect(detectProvider(makeConfig({ smtpPass: "app-password" }))).toBe("gmail_smtp");
  });

  it("명시적 provider='resend' + 두 키 모두 있으면 'resend'", () => {
    expect(
      detectProvider(
        makeConfig({
          provider: "resend",
          resendKey: "re_test_123",
          smtpPass: "app-password",
        }),
      ),
    ).toBe("resend");
  });

  it("명시적 provider='smtp' + smtp_pass → 'custom_smtp'", () => {
    expect(
      detectProvider(
        makeConfig({
          provider: "smtp",
          smtpPass: "app-password",
        }),
      ),
    ).toBe("custom_smtp");
  });

  it("명시적 provider='gmail' + smtp_pass → 'gmail_smtp'", () => {
    expect(
      detectProvider(
        makeConfig({
          provider: "gmail",
          smtpPass: "app-password",
        }),
      ),
    ).toBe("gmail_smtp");
  });

  it("resend_key와 smtp_pass 모두 있으면 resend 우선 (자동 감지)", () => {
    expect(
      detectProvider(
        makeConfig({
          resendKey: "re_test_123",
          smtpPass: "app-password",
        }),
      ),
    ).toBe("resend");
  });
});
