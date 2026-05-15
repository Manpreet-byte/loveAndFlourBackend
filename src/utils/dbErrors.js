export function isSchemaMismatchError(err) {
  const code = err?.code;
  return (
    code === 'ER_NO_SUCH_TABLE' ||
    code === 'ER_BAD_FIELD_ERROR' ||
    code === 'ER_PARSE_ERROR' ||
    code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
    code === 'ER_NO_REFERENCED_ROW_2' ||
    code === 'ER_ROW_IS_REFERENCED_2'
  );
}

