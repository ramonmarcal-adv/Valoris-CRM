import type { OperationCardFieldDef, OperationCardFieldValue } from "@/types";

/**
 * A field def with stage_id === null applies to every stage; one with
 * stage_id set only applies (and can only be required) on that one
 * stage — the minimal model described in migration 062's header.
 */
export function resolveVisibleFields(
  defs: OperationCardFieldDef[],
  currentStageId: string,
): OperationCardFieldDef[] {
  return defs
    .filter((def) => !def.archived_at && (def.stage_id === null || def.stage_id === currentStageId))
    .sort((a, b) => a.position - b.position);
}

function isValueEmpty(value: OperationCardFieldValue | undefined, fieldType: OperationCardFieldDef["field_type"]): boolean {
  if (!value) return true;
  switch (fieldType) {
    case "long_text":
      return !value.long_text?.trim();
    case "number":
    case "currency":
      return value.value_number == null;
    case "date":
    case "datetime":
      return !value.value_date;
    case "checkbox":
      return value.value_boolean == null;
    case "user":
    case "contact":
    case "related_card":
      return !value.value_uuid;
    case "multi_select":
      return !value.value_multi_select || value.value_multi_select.length === 0;
    default: // short_text, single_select, phone, email, url
      return !value.value_text?.trim();
  }
}

/**
 * Returns the field defs that are required-and-empty on the card's
 * current stage — an empty array means the card can be saved. Mirrors
 * PRD 5.4 ("campos obrigatórios apenas em determinada fase").
 */
export function findMissingRequiredFields(
  defs: OperationCardFieldDef[],
  values: OperationCardFieldValue[],
  currentStageId: string,
): OperationCardFieldDef[] {
  const valueByFieldDefId = new Map(values.map((v) => [v.field_def_id, v]));
  return resolveVisibleFields(defs, currentStageId).filter(
    (def) => def.is_required && isValueEmpty(valueByFieldDefId.get(def.id), def.field_type),
  );
}

/** Which typed column on operation_card_field_values a given field_type writes to. */
export function valueColumnForFieldType(
  fieldType: OperationCardFieldDef["field_type"],
): keyof OperationCardFieldValue {
  switch (fieldType) {
    case "long_text":
      return "long_text";
    case "number":
    case "currency":
      return "value_number";
    case "date":
    case "datetime":
      return "value_date";
    case "checkbox":
      return "value_boolean";
    case "user":
    case "contact":
    case "related_card":
      return "value_uuid";
    case "multi_select":
      return "value_multi_select";
    default: // short_text, single_select, phone, email, url
      return "value_text";
  }
}
