import type { TutorialStep } from "../types.js"

export const accountSteps: TutorialStep[] = [
  // ── Section 1: Welcome ──
  {
    target: ".account-page",
    titleKey: "tutorial.account.welcomeTitle",
    bodyKey: "tutorial.account.welcomeBody",
    placement: "bottom",
  },

  // ── Section 2: Profile & Subscription Card ──
  {
    target: ".account-profile-card",
    titleKey: "tutorial.account.profileCardTitle",
    bodyKey: "tutorial.account.profileCardBody",
    placement: "bottom",
  },
  {
    target: ".account-profile-identity",
    titleKey: "tutorial.account.identityTitle",
    bodyKey: "tutorial.account.identityBody",
    placement: "bottom",
  },
  {
    target: ".account-profile-header .btn-danger",
    titleKey: "tutorial.account.logoutTitle",
    bodyKey: "tutorial.account.logoutBody",
    placement: "left",
  },
  {
    target: ".account-info-grid .account-info-item:nth-child(1)",
    titleKey: "tutorial.account.planTitle",
    bodyKey: "tutorial.account.planBody",
    placement: "bottom",
  },
  {
    target: ".account-info-grid .account-info-item:nth-child(2)",
    titleKey: "tutorial.account.memberSinceTitle",
    bodyKey: "tutorial.account.memberSinceBody",
    placement: "bottom",
  },
  {
    target: ".account-info-grid .account-info-item:nth-child(3)",
    titleKey: "tutorial.account.validUntilTitle",
    bodyKey: "tutorial.account.validUntilBody",
    placement: "bottom",
  },
  {
    target: ".quota-five-hour",
    titleKey: "tutorial.account.quotaFiveHourTitle",
    bodyKey: "tutorial.account.quotaFiveHourBody",
    placement: "bottom",
  },
  {
    target: ".quota-weekly",
    titleKey: "tutorial.account.quotaWeeklyTitle",
    bodyKey: "tutorial.account.quotaWeeklyBody",
    placement: "bottom",
  },

  // ── Section 3: Surfaces ──
  {
    target: ".account-page > .section-card:nth-of-type(2)",
    titleKey: "tutorial.account.surfacesSectionTitle",
    bodyKey: "tutorial.account.surfacesSectionBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(2) .acct-section-header",
    titleKey: "tutorial.account.surfacesHeaderTitle",
    bodyKey: "tutorial.account.surfacesHeaderBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(2) .btn-primary",
    titleKey: "tutorial.account.createSurfaceBtnTitle",
    bodyKey: "tutorial.account.createSurfaceBtnBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(2) .btn-secondary",
    titleKey: "tutorial.account.fromPresetBtnTitle",
    bodyKey: "tutorial.account.fromPresetBtnBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(2) .acct-item-list, .account-page > .section-card:nth-of-type(2) .empty-cell",
    titleKey: "tutorial.account.surfaceListTitle",
    bodyKey: "tutorial.account.surfaceListBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(2) .acct-item:first-child",
    titleKey: "tutorial.account.surfaceItemTitle",
    bodyKey: "tutorial.account.surfaceItemBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(2) .acct-tool-chips",
    titleKey: "tutorial.account.surfaceToolChipsTitle",
    bodyKey: "tutorial.account.surfaceToolChipsBody",
    placement: "bottom",
  },

  // ── Section 4: Run Profiles ──
  {
    target: ".account-page > .section-card:nth-of-type(3)",
    titleKey: "tutorial.account.profilesSectionTitle",
    bodyKey: "tutorial.account.profilesSectionBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(3) .acct-section-header",
    titleKey: "tutorial.account.profilesHeaderTitle",
    bodyKey: "tutorial.account.profilesHeaderBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(3) .btn-primary",
    titleKey: "tutorial.account.createProfileBtnTitle",
    bodyKey: "tutorial.account.createProfileBtnBody",
    placement: "bottom",
  },
  {
    target: ".acct-default-profile",
    titleKey: "tutorial.account.defaultProfileTitle",
    bodyKey: "tutorial.account.defaultProfileBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(3) .acct-item-list, .account-page > .section-card:nth-of-type(3) .empty-cell",
    titleKey: "tutorial.account.profileListTitle",
    bodyKey: "tutorial.account.profileListBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(3) .acct-item:first-child",
    titleKey: "tutorial.account.profileItemTitle",
    bodyKey: "tutorial.account.profileItemBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(3) .acct-tool-chips",
    titleKey: "tutorial.account.profileToolChipsTitle",
    bodyKey: "tutorial.account.profileToolChipsBody",
    placement: "top",
  },

  // ── Section 5: Modules ──
  {
    target: ".account-page > .section-card:nth-of-type(4)",
    titleKey: "tutorial.account.modulesSectionTitle",
    bodyKey: "tutorial.account.modulesSectionBody",
    placement: "bottom",
  },
  {
    target: ".account-page > .section-card:nth-of-type(4) .module-card",
    titleKey: "tutorial.account.moduleItemTitle",
    bodyKey: "tutorial.account.moduleItemBody",
    placement: "bottom",
  },
]
