import { ensure } from './validation.mjs';

export const conflictMessage='Dữ liệu đã thay đổi. Hãy tải bản mới và đối chiếu trước khi lưu lại.';

export function requestVersion(request) {
  const value=request.get('if-match');
  ensure(value,428,'Cần tải phiên bản hiện tại trước khi thay đổi.');
  const match=/^"([1-9]\d{0,9})"$/.exec(value);
  const version=Number(match?.[1]);
  ensure(match&&version<=2147483647,400,'Phiên bản dữ liệu không hợp lệ.');
  return version;
}

export function checkVersion(version,expected) {
  ensure(expected===undefined||version===expected,412,conflictMessage);
}
