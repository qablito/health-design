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
export declare const CommercialProductSnapshotSchema: z.ZodObject<{
    basis: z.ZodEnum<{
        per_100_g: "per_100_g";
        per_100_ml: "per_100_ml";
    }>;
    brand: z.ZodOptional<z.ZodString>;
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
        available: "available";
        not_found: "not_found";
        unavailable: "unavailable";
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
export type ProductSymbology = (typeof PRODUCT_SYMBOLOGIES)[number];
export type ProductGtin = z.infer<typeof ProductGtinSchema>;
export type ProductNutrientValue = z.infer<typeof ProductNutrientValueSchema>;
export type ProductStructuredTextList = z.infer<typeof ProductStructuredTextListSchema>;
export type CommercialProductSnapshot = z.infer<typeof CommercialProductSnapshotSchema>;
export type CommercialProductSource = (typeof COMMERCIAL_PRODUCT_SOURCES)[number];
export type CommercialProductCompleteness = (typeof COMMERCIAL_PRODUCT_COMPLETENESS)[number];
export type ProductResolutionResponse = z.infer<typeof ProductResolutionResponseSchema>;
export type ProductConfirmationRequest = z.infer<typeof ProductConfirmationRequestSchema>;
export type ProductConfirmationAck = z.infer<typeof ProductConfirmationAckSchema>;
