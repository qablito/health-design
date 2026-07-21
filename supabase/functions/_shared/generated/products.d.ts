import type { z } from "zod";
export declare const PRODUCT_SYMBOLOGIES: readonly ["ean_8", "ean_13", "upc_a", "upc_e", "itf_14"];
export declare const PRODUCT_NUTRITION_BASES: readonly ["per_100_g", "per_100_ml"];
export declare const COMMERCIAL_PRODUCT_SOURCES: readonly ["profile", "global", "confirmed_label", "open_food_facts", "manual_blank"];
export declare const COMMERCIAL_PRODUCT_COMPLETENESS: readonly ["complete", "provisional", "insufficient"];
export declare const ProductGtinSchema: z.ZodObject<{
    displayGtin: z.ZodString;
    gtin14: z.ZodString;
    symbology: z.ZodEnum<{
        ean_8: "ean_8";
        ean_13: "ean_13";
        upc_a: "upc_a";
        upc_e: "upc_e";
        itf_14: "itf_14";
    }>;
}, z.core.$strict>;
export declare const ProductNutrientValueSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    state: z.ZodLiteral<"known">;
    unit: z.ZodEnum<{
        g: "g";
        mg: "mg";
        ug: "ug";
        kcal: "kcal";
    }>;
    value: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    estimation: z.ZodObject<{
        method: z.ZodEnum<{
            confirmed_conversion: "confirmed_conversion";
            estimated_from_canonical: "estimated_from_canonical";
        }>;
        sourceRef: z.ZodString;
    }, z.core.$strict>;
    state: z.ZodLiteral<"estimated">;
    unit: z.ZodEnum<{
        g: "g";
        mg: "mg";
        ug: "ug";
        kcal: "kcal";
    }>;
    value: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"unknown">;
}, z.core.$strict>], "state">;
export declare const ProductStructuredTextListSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    state: z.ZodLiteral<"known">;
    values: z.ZodArray<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"unknown">;
}, z.core.$strict>], "state">;
export declare const ProductDensitySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    gramsPerMl: z.ZodString;
    sourceRef: z.ZodString;
    state: z.ZodLiteral<"known">;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"unknown">;
}, z.core.$strict>], "state">;
export declare const CommercialProductSnapshotSchema: z.ZodObject<{
    basis: z.ZodEnum<{
        per_100_g: "per_100_g";
        per_100_ml: "per_100_ml";
    }>;
    brand: z.ZodOptional<z.ZodString>;
    density: z.ZodDiscriminatedUnion<[z.ZodObject<{
        gramsPerMl: z.ZodString;
        sourceRef: z.ZodString;
        state: z.ZodLiteral<"known">;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodLiteral<"unknown">;
    }, z.core.$strict>], "state">;
    gtin: z.ZodObject<{
        displayGtin: z.ZodString;
        gtin14: z.ZodString;
        symbology: z.ZodEnum<{
            ean_8: "ean_8";
            ean_13: "ean_13";
            upc_a: "upc_a";
            upc_e: "upc_e";
            itf_14: "itf_14";
        }>;
    }, z.core.$strict>;
    name: z.ZodString;
    nutrients: z.ZodObject<{
        carbohydratesG: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        clinical: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">>;
        energyKcal: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        fatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        fiberG: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        proteinG: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        saltG: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        saturatedFatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        sugarsG: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            estimation: z.ZodObject<{
                method: z.ZodEnum<{
                    confirmed_conversion: "confirmed_conversion";
                    estimated_from_canonical: "estimated_from_canonical";
                }>;
                sourceRef: z.ZodString;
            }, z.core.$strict>;
            state: z.ZodLiteral<"estimated">;
            unit: z.ZodEnum<{
                g: "g";
                mg: "mg";
                ug: "ug";
                kcal: "kcal";
            }>;
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
    }, z.core.$strict>;
    package: z.ZodOptional<z.ZodObject<{
        amount: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        unit: z.ZodOptional<z.ZodEnum<{
            g: "g";
            unit: "unit";
            kg: "kg";
            ml: "ml";
            l: "l";
        }>>;
    }, z.core.$strict>>;
    safety: z.ZodObject<{
        allergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            values: z.ZodArray<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        crossContactAllergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            values: z.ZodArray<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        ingredients: z.ZodDiscriminatedUnion<[z.ZodObject<{
            state: z.ZodLiteral<"known">;
            values: z.ZodArray<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const ProductMatchingSummarySchema: z.ZodObject<{
    canonicalFoodKey: z.ZodString;
    messageKey: z.ZodString;
    state: z.ZodEnum<{
        exact: "exact";
        insufficient: "insufficient";
        allowed: "allowed";
        review: "review";
        excluded: "excluded";
    }>;
}, z.core.$strict>;
export declare const ProductResolutionResponseSchema: z.ZodObject<{
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
        insufficient: "insufficient";
    }>;
    confirmedForProfile: z.ZodBoolean;
    contentHash: z.ZodNullable<z.ZodString>;
    gtin: z.ZodObject<{
        displayGtin: z.ZodString;
        gtin14: z.ZodString;
        symbology: z.ZodEnum<{
            ean_8: "ean_8";
            ean_13: "ean_13";
            upc_a: "upc_a";
            upc_e: "upc_e";
            itf_14: "itf_14";
        }>;
    }, z.core.$strict>;
    matching: z.ZodNullable<z.ZodObject<{
        canonicalFoodKey: z.ZodString;
        messageKey: z.ZodString;
        state: z.ZodEnum<{
            exact: "exact";
            insufficient: "insufficient";
            allowed: "allowed";
            review: "review";
            excluded: "excluded";
        }>;
    }, z.core.$strict>>;
    revisionId: z.ZodNullable<z.ZodUUID>;
    schemaVersion: z.ZodLiteral<1>;
    snapshot: z.ZodNullable<z.ZodObject<{
        basis: z.ZodEnum<{
            per_100_g: "per_100_g";
            per_100_ml: "per_100_ml";
        }>;
        brand: z.ZodOptional<z.ZodString>;
        density: z.ZodDiscriminatedUnion<[z.ZodObject<{
            gramsPerMl: z.ZodString;
            sourceRef: z.ZodString;
            state: z.ZodLiteral<"known">;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        gtin: z.ZodObject<{
            displayGtin: z.ZodString;
            gtin14: z.ZodString;
            symbology: z.ZodEnum<{
                ean_8: "ean_8";
                ean_13: "ean_13";
                upc_a: "upc_a";
                upc_e: "upc_e";
                itf_14: "itf_14";
            }>;
        }, z.core.$strict>;
        name: z.ZodString;
        nutrients: z.ZodObject<{
            carbohydratesG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            clinical: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">>;
            energyKcal: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fiberG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            proteinG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saltG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saturatedFatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            sugarsG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        package: z.ZodOptional<z.ZodObject<{
            amount: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            unit: z.ZodOptional<z.ZodEnum<{
                g: "g";
                unit: "unit";
                kg: "kg";
                ml: "ml";
                l: "l";
            }>>;
        }, z.core.$strict>>;
        safety: z.ZodObject<{
            allergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            crossContactAllergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            ingredients: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        schemaVersion: z.ZodLiteral<1>;
    }, z.core.$strict>>;
    source: z.ZodEnum<{
        profile: "profile";
        global: "global";
        confirmed_label: "confirmed_label";
        open_food_facts: "open_food_facts";
        manual_blank: "manual_blank";
    }>;
    sourceAvailability: z.ZodEnum<{
        unavailable: "unavailable";
        available: "available";
        not_found: "not_found";
    }>;
    uncertainties: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const ProductConfirmationRequestSchema: z.ZodObject<{
    baseRevisionId: z.ZodOptional<z.ZodUUID>;
    expectedContentHash: z.ZodOptional<z.ZodString>;
    schemaVersion: z.ZodLiteral<1>;
    snapshot: z.ZodObject<{
        basis: z.ZodEnum<{
            per_100_g: "per_100_g";
            per_100_ml: "per_100_ml";
        }>;
        brand: z.ZodOptional<z.ZodString>;
        density: z.ZodDiscriminatedUnion<[z.ZodObject<{
            gramsPerMl: z.ZodString;
            sourceRef: z.ZodString;
            state: z.ZodLiteral<"known">;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        gtin: z.ZodObject<{
            displayGtin: z.ZodString;
            gtin14: z.ZodString;
            symbology: z.ZodEnum<{
                ean_8: "ean_8";
                ean_13: "ean_13";
                upc_a: "upc_a";
                upc_e: "upc_e";
                itf_14: "itf_14";
            }>;
        }, z.core.$strict>;
        name: z.ZodString;
        nutrients: z.ZodObject<{
            carbohydratesG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            clinical: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">>;
            energyKcal: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fiberG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            proteinG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saltG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saturatedFatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            sugarsG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        package: z.ZodOptional<z.ZodObject<{
            amount: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            unit: z.ZodOptional<z.ZodEnum<{
                g: "g";
                unit: "unit";
                kg: "kg";
                ml: "ml";
                l: "l";
            }>>;
        }, z.core.$strict>>;
        safety: z.ZodObject<{
            allergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            crossContactAllergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            ingredients: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        schemaVersion: z.ZodLiteral<1>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ProductConfirmationAckSchema: z.ZodObject<{
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
        insufficient: "insufficient";
    }>;
    confirmationId: z.ZodUUID;
    confirmedAt: z.ZodISODateTime;
    correctionId: z.ZodNullable<z.ZodUUID>;
    productId: z.ZodUUID;
    reusedRevision: z.ZodBoolean;
    revisionId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
    scope: z.ZodLiteral<"profile">;
}, z.core.$strict>;
export declare const ConfirmedProductApplicationSchema: z.ZodObject<{
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
        insufficient: "insufficient";
    }>;
    confirmationId: z.ZodUUID;
    contentHash: z.ZodString;
    manifestId: z.ZodUUID;
    matching: z.ZodObject<{
        canonicalFoodKey: z.ZodString;
        messageKey: z.ZodString;
        state: z.ZodEnum<{
            exact: "exact";
            insufficient: "insufficient";
            allowed: "allowed";
            review: "review";
            excluded: "excluded";
        }>;
    }, z.core.$strict>;
    productId: z.ZodUUID;
    revisionId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
    snapshot: z.ZodObject<{
        basis: z.ZodEnum<{
            per_100_g: "per_100_g";
            per_100_ml: "per_100_ml";
        }>;
        brand: z.ZodOptional<z.ZodString>;
        density: z.ZodDiscriminatedUnion<[z.ZodObject<{
            gramsPerMl: z.ZodString;
            sourceRef: z.ZodString;
            state: z.ZodLiteral<"known">;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        gtin: z.ZodObject<{
            displayGtin: z.ZodString;
            gtin14: z.ZodString;
            symbology: z.ZodEnum<{
                ean_8: "ean_8";
                ean_13: "ean_13";
                upc_a: "upc_a";
                upc_e: "upc_e";
                itf_14: "itf_14";
            }>;
        }, z.core.$strict>;
        name: z.ZodString;
        nutrients: z.ZodObject<{
            carbohydratesG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            clinical: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">>;
            energyKcal: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fiberG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            proteinG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saltG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saturatedFatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            sugarsG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        package: z.ZodOptional<z.ZodObject<{
            amount: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            unit: z.ZodOptional<z.ZodEnum<{
                g: "g";
                unit: "unit";
                kg: "kg";
                ml: "ml";
                l: "l";
            }>>;
        }, z.core.$strict>>;
        safety: z.ZodObject<{
            allergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            crossContactAllergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            ingredients: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        schemaVersion: z.ZodLiteral<1>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ADMIN_BARCODE_CORRECTION_STATUSES: readonly ["pending", "approved", "rejected", "superseded"];
export declare const ADMIN_BARCODE_REJECTION_REASONS: readonly ["duplicate", "insufficient_evidence", "invalid_data", "safety_risk"];
export declare const AdminBarcodeCorrectionListSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        brand: z.ZodOptional<z.ZodString>;
        completeness: z.ZodEnum<{
            complete: "complete";
            provisional: "provisional";
            insufficient: "insufficient";
        }>;
        correctionId: z.ZodUUID;
        createdAt: z.ZodISODateTime;
        duplicateCount: z.ZodNumber;
        gtin14: z.ZodString;
        name: z.ZodString;
        profileId: z.ZodUUID;
        status: z.ZodEnum<{
            approved: "approved";
            pending: "pending";
            rejected: "rejected";
            superseded: "superseded";
        }>;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    nextCursor: z.ZodNullable<z.ZodUUID>;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminBarcodeCorrectionDetailSchema: z.ZodObject<{
    baseSnapshot: z.ZodNullable<z.ZodObject<{
        basis: z.ZodEnum<{
            per_100_g: "per_100_g";
            per_100_ml: "per_100_ml";
        }>;
        brand: z.ZodOptional<z.ZodString>;
        density: z.ZodDiscriminatedUnion<[z.ZodObject<{
            gramsPerMl: z.ZodString;
            sourceRef: z.ZodString;
            state: z.ZodLiteral<"known">;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        gtin: z.ZodObject<{
            displayGtin: z.ZodString;
            gtin14: z.ZodString;
            symbology: z.ZodEnum<{
                ean_8: "ean_8";
                ean_13: "ean_13";
                upc_a: "upc_a";
                upc_e: "upc_e";
                itf_14: "itf_14";
            }>;
        }, z.core.$strict>;
        name: z.ZodString;
        nutrients: z.ZodObject<{
            carbohydratesG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            clinical: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">>;
            energyKcal: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fiberG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            proteinG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saltG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saturatedFatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            sugarsG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        package: z.ZodOptional<z.ZodObject<{
            amount: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            unit: z.ZodOptional<z.ZodEnum<{
                g: "g";
                unit: "unit";
                kg: "kg";
                ml: "ml";
                l: "l";
            }>>;
        }, z.core.$strict>>;
        safety: z.ZodObject<{
            allergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            crossContactAllergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            ingredients: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        schemaVersion: z.ZodLiteral<1>;
    }, z.core.$strict>>;
    correctionId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    globalSnapshot: z.ZodNullable<z.ZodObject<{
        basis: z.ZodEnum<{
            per_100_g: "per_100_g";
            per_100_ml: "per_100_ml";
        }>;
        brand: z.ZodOptional<z.ZodString>;
        density: z.ZodDiscriminatedUnion<[z.ZodObject<{
            gramsPerMl: z.ZodString;
            sourceRef: z.ZodString;
            state: z.ZodLiteral<"known">;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        gtin: z.ZodObject<{
            displayGtin: z.ZodString;
            gtin14: z.ZodString;
            symbology: z.ZodEnum<{
                ean_8: "ean_8";
                ean_13: "ean_13";
                upc_a: "upc_a";
                upc_e: "upc_e";
                itf_14: "itf_14";
            }>;
        }, z.core.$strict>;
        name: z.ZodString;
        nutrients: z.ZodObject<{
            carbohydratesG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            clinical: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">>;
            energyKcal: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fiberG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            proteinG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saltG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saturatedFatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            sugarsG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        package: z.ZodOptional<z.ZodObject<{
            amount: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            unit: z.ZodOptional<z.ZodEnum<{
                g: "g";
                unit: "unit";
                kg: "kg";
                ml: "ml";
                l: "l";
            }>>;
        }, z.core.$strict>>;
        safety: z.ZodObject<{
            allergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            crossContactAllergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            ingredients: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        schemaVersion: z.ZodLiteral<1>;
    }, z.core.$strict>>;
    profileId: z.ZodUUID;
    productId: z.ZodUUID;
    proposedSnapshot: z.ZodObject<{
        basis: z.ZodEnum<{
            per_100_g: "per_100_g";
            per_100_ml: "per_100_ml";
        }>;
        brand: z.ZodOptional<z.ZodString>;
        density: z.ZodDiscriminatedUnion<[z.ZodObject<{
            gramsPerMl: z.ZodString;
            sourceRef: z.ZodString;
            state: z.ZodLiteral<"known">;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        gtin: z.ZodObject<{
            displayGtin: z.ZodString;
            gtin14: z.ZodString;
            symbology: z.ZodEnum<{
                ean_8: "ean_8";
                ean_13: "ean_13";
                upc_a: "upc_a";
                upc_e: "upc_e";
                itf_14: "itf_14";
            }>;
        }, z.core.$strict>;
        name: z.ZodString;
        nutrients: z.ZodObject<{
            carbohydratesG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            clinical: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">>;
            energyKcal: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fiberG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            proteinG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saltG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saturatedFatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            sugarsG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        package: z.ZodOptional<z.ZodObject<{
            amount: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            unit: z.ZodOptional<z.ZodEnum<{
                g: "g";
                unit: "unit";
                kg: "kg";
                ml: "ml";
                l: "l";
            }>>;
        }, z.core.$strict>>;
        safety: z.ZodObject<{
            allergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            crossContactAllergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            ingredients: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        schemaVersion: z.ZodLiteral<1>;
    }, z.core.$strict>;
    reviewRevisionId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        approved: "approved";
        pending: "pending";
        rejected: "rejected";
        superseded: "superseded";
    }>;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminBarcodeCorrectionRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    snapshot: z.ZodObject<{
        basis: z.ZodEnum<{
            per_100_g: "per_100_g";
            per_100_ml: "per_100_ml";
        }>;
        brand: z.ZodOptional<z.ZodString>;
        density: z.ZodDiscriminatedUnion<[z.ZodObject<{
            gramsPerMl: z.ZodString;
            sourceRef: z.ZodString;
            state: z.ZodLiteral<"known">;
        }, z.core.$strict>, z.ZodObject<{
            state: z.ZodLiteral<"unknown">;
        }, z.core.$strict>], "state">;
        gtin: z.ZodObject<{
            displayGtin: z.ZodString;
            gtin14: z.ZodString;
            symbology: z.ZodEnum<{
                ean_8: "ean_8";
                ean_13: "ean_13";
                upc_a: "upc_a";
                upc_e: "upc_e";
                itf_14: "itf_14";
            }>;
        }, z.core.$strict>;
        name: z.ZodString;
        nutrients: z.ZodObject<{
            carbohydratesG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            clinical: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">>;
            energyKcal: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            fiberG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            proteinG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saltG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            saturatedFatG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            sugarsG: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                estimation: z.ZodObject<{
                    method: z.ZodEnum<{
                        confirmed_conversion: "confirmed_conversion";
                        estimated_from_canonical: "estimated_from_canonical";
                    }>;
                    sourceRef: z.ZodString;
                }, z.core.$strict>;
                state: z.ZodLiteral<"estimated">;
                unit: z.ZodEnum<{
                    g: "g";
                    mg: "mg";
                    ug: "ug";
                    kcal: "kcal";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        package: z.ZodOptional<z.ZodObject<{
            amount: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            unit: z.ZodOptional<z.ZodEnum<{
                g: "g";
                unit: "unit";
                kg: "kg";
                ml: "ml";
                l: "l";
            }>>;
        }, z.core.$strict>>;
        safety: z.ZodObject<{
            allergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            crossContactAllergens: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
            ingredients: z.ZodDiscriminatedUnion<[z.ZodObject<{
                state: z.ZodLiteral<"known">;
                values: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                state: z.ZodLiteral<"unknown">;
            }, z.core.$strict>], "state">;
        }, z.core.$strict>;
        schemaVersion: z.ZodLiteral<1>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const AdminBarcodeCorrectionApproveRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    canonicalFoodKey: z.ZodString;
    evidence: z.ZodArray<z.ZodString>;
    matchState: z.ZodEnum<{
        exact: "exact";
        insufficient: "insufficient";
        allowed: "allowed";
        review: "review";
        excluded: "excluded";
    }>;
}, z.core.$strict>;
export declare const AdminBarcodeCorrectionRejectRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    reason: z.ZodEnum<{
        duplicate: "duplicate";
        insufficient_evidence: "insufficient_evidence";
        invalid_data: "invalid_data";
        safety_risk: "safety_risk";
    }>;
}, z.core.$strict>;
export declare const AdminMatchingRuleActivateRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const AdminBarcodeCorrectionMutationAckSchema: z.ZodObject<{
    auditClosure: z.ZodOptional<z.ZodLiteral<"pending">>;
    correctionId: z.ZodUUID;
    globalRevisionId: z.ZodNullable<z.ZodUUID>;
    matchingRuleId: z.ZodNullable<z.ZodUUID>;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        approved: "approved";
        pending: "pending";
        rejected: "rejected";
        superseded: "superseded";
    }>;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const AdminMatchingRuleMutationAckSchema: z.ZodObject<{
    auditClosure: z.ZodOptional<z.ZodLiteral<"pending">>;
    matchingRuleId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
    status: z.ZodEnum<{
        active: "active";
        draft: "draft";
        superseded: "superseded";
        withdrawn: "withdrawn";
    }>;
    version: z.ZodNumber;
}, z.core.$strict>;
export type ProductSymbology = (typeof PRODUCT_SYMBOLOGIES)[number];
export type ProductGtin = z.infer<typeof ProductGtinSchema>;
export type ProductNutrientValue = z.infer<typeof ProductNutrientValueSchema>;
export type ProductDensity = z.infer<typeof ProductDensitySchema>;
export type ProductStructuredTextList = z.infer<typeof ProductStructuredTextListSchema>;
export type CommercialProductSnapshot = z.infer<typeof CommercialProductSnapshotSchema>;
export type CommercialProductSource = (typeof COMMERCIAL_PRODUCT_SOURCES)[number];
export type CommercialProductCompleteness = (typeof COMMERCIAL_PRODUCT_COMPLETENESS)[number];
export type ProductResolutionResponse = z.infer<typeof ProductResolutionResponseSchema>;
export type ProductConfirmationRequest = z.infer<typeof ProductConfirmationRequestSchema>;
export type ProductConfirmationAck = z.infer<typeof ProductConfirmationAckSchema>;
export type ConfirmedProductApplication = z.infer<typeof ConfirmedProductApplicationSchema>;
export type AdminBarcodeCorrectionList = z.infer<typeof AdminBarcodeCorrectionListSchema>;
export type AdminBarcodeCorrectionDetail = z.infer<typeof AdminBarcodeCorrectionDetailSchema>;
export type AdminBarcodeCorrectionMutationAck = z.infer<typeof AdminBarcodeCorrectionMutationAckSchema>;
export type AdminMatchingRuleMutationAck = z.infer<typeof AdminMatchingRuleMutationAckSchema>;
