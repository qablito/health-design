export type ExercisePublication = Readonly<{
  anatomicalReview: "approved";
  license: string;
  licenseStatus: "approved";
  provenance: string;
  reviewId: string;
  reviewScope: string;
  reviewedAt: string;
  reviewer: string;
  status: "published";
}>;

export type ExercisePublicationLedgerEntry = Readonly<{
  assetSha256: string;
  exerciseId: string;
  publication: ExercisePublication;
}>;

const license = "Activo original Health Design";
const provenance = "Ilustración SVG secuencial creada para T11";
const reviewScope =
  "Revisión visual técnica de postura, apoyos, articulaciones y correspondencia con los pasos escritos.";
const reviewedAt = "2026-07-19";
const reviewer = "codex-t11-visual-audit";

export const EXERCISE_PUBLICATION_LEDGER = [
  {
    assetSha256: "f2df634e33ea6e8a5801cdd47eff75126e5eb976749df5050b2f2149ac3025da",
    exerciseId: "march-in-place",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-march-in-place-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "cae06d2aad7bbca7bf84eec1e1d9603e7c2619a90ca9e5efe0630ccb78ab5aca",
    exerciseId: "lateral-step",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-lateral-step-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "a45e5d8a2cb095293df42f7ccb24ccca9b215c6996cd705c8be18e9045c47b0c",
    exerciseId: "shoulder-circles",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-shoulder-circles-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "d2b2addeeb15d8497f06343a552f3ee4e4b6f7db9c4a1c08492b1419598c8a23",
    exerciseId: "bodyweight-squat",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-bodyweight-squat-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "981585c717d782902f5db0ac170b0f3c70c24aa1b80372641ca669077a54f3bf",
    exerciseId: "supported-squat",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-supported-squat-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "99f2fdd1e1b1552b22e5e6e41a68168a9b9015e1a0e343690f304680cbf78416",
    exerciseId: "incline-push-up",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-incline-push-up-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "52b8d12074d0434ac48879aeac02297d7e402b814be3191e32c1851bb72de603",
    exerciseId: "wall-push-up",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-wall-push-up-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "4bb36120f4525b9710adbc6974bfa5e03e905dc2cee4e1b4cef4122f34069a10",
    exerciseId: "hip-hinge",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-hip-hinge-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "44754e760b716f5d7710649aacc439597d59ecb64e6e6939de8aaa0a7d653917",
    exerciseId: "glute-bridge",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-glute-bridge-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "48218b2ed380f1f8fc8d0c91ca4daaa730ba7667837182a08454c40991252f23",
    exerciseId: "dead-bug",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-dead-bug-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "f3e0f64d543e7dfa6f367fcd02a898686182acaf19f8650e0d574094087bcee1",
    exerciseId: "neck-nod",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-neck-nod-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "13a21052dea07e1b6c5b9b5e2c55461fb01d35e35e6a10f3fd1d5ba73b171c14",
    exerciseId: "cat-cow",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-cat-cow-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "64720db81f11c12a5a16933f7a6da965b79ff875e6451efbaff229df83dcbacc",
    exerciseId: "thoracic-rotation",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-thoracic-rotation-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "959b46ac71ded067caff374742aa459b72665e9bb579697452c4a735fbc0bef1",
    exerciseId: "hip-90-90",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-hip-90-90-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "cb5b42228092f7f259843364881887a72a5ee3636d10c8a1388e371169ab60f4",
    exerciseId: "knee-extension",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-knee-extension-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "eaeb2b40fd271620e64af6677a17577ff3000061af64ce878acde105f7557d07",
    exerciseId: "ankle-rock",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-ankle-rock-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "7abfb8b5bd8c2208cf6a0ba0afadb85296141dff4b8cffbd62262991a9814afc",
    exerciseId: "dumbbell-goblet-squat",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-dumbbell-goblet-squat-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "6166007d03bd65f75f452fb0e1cd95902be01ac60c5e924b3d15f34430e61130",
    exerciseId: "resistance-band-row",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-resistance-band-row-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "717fa8aa1715909daa928ae5b0f61ca8d44615a3cbaed9b9b19ea39f5ad4d63e",
    exerciseId: "dumbbell-row",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-dumbbell-row-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
  {
    assetSha256: "6935323ab8b175e138bc3a962ce0c873775f187a2b423d993f2de44d2bd922fb",
    exerciseId: "dumbbell-floor-press",
    publication: {
      anatomicalReview: "approved",
      license,
      licenseStatus: "approved",
      provenance,
      reviewId: "t11-anatomy-dumbbell-floor-press-20260719",
      reviewScope,
      reviewedAt,
      reviewer,
      status: "published",
    },
  },
] as const satisfies readonly ExercisePublicationLedgerEntry[];
