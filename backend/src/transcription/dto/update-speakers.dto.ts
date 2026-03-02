/** 話者名更新DTO */
export class UpdateSpeakersDto {
  /** 更新する話者情報の配列 */
  speakers: { id: string; name: string }[];
}
