const FormData = require('form-data');

/**
 * 도(decimal degrees) → DMS 문자열 변환
 * 예: toDMS(37.5573, true) → "37° 33' 26\" N"
 */
function toDMS(deg, isLat) {
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFull = (abs - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60);
  return `${d}\u00B0 ${String(m).padStart(2, '0')}\u2032 ${String(s).padStart(2, '0')}\u2033 ${dir}`;
}

/**
 * 미터 → 피트 변환
 */
function mToFt(m) {
  return String(Math.round(Number(m) * 3.28084));
}

/**
 * registerP용 multipart FormData 구성
 *
 * @param {Object} opts
 * @param {Object} opts.userInfo   - registerF에서 스크랩한 신청자 프로필
 * @param {Array}  opts.circles    - [{ lon, lat, address, addrId }]
 * @param {Object} opts.aircraft   - 선택된 기체 데이터
 * @param {Object} opts.params     - 신청 파라미터 (dates, altitude, purpose 등)
 * @param {Object} opts.attachments - { photo, insurance, business, testflight, operationManual, businessP }
 *   각 항목: { buffer, name, mimetype } 또는 null
 * @param {Object} opts.agency     - { PRO_USER, PRO_USERS, PRO_USER2, PRO_USERS2 }
 */
function buildRegisterForm({ userInfo, circles, aircraft, params, attachments, agency }) {
  const form = new FormData();
  const s = (v) => (v != null ? String(v) : '');

  // ═══════ 신청자 정보 ═══════
  form.append('AC_FLIGHT_ID', '');
  form.append('APPLY_USER', s(userInfo.APPLY_USER));
  form.append('AC_AERO_ID', '');
  form.append('APPLY_USER_NM', s(userInfo.APPLY_USER_NM));
  form.append('APPLY_BIRTHDAY_YMD', s(userInfo.APPLY_BIRTHDAY_YMD));
  form.append('APPLY_PHONE_NO', s(userInfo.APPLY_PHONE_NO));
  form.append('APPLY_TEL_NO', s(userInfo.APPLY_TEL_NO));
  form.append('APPLY_FAX_NO', '');
  form.append('AERO_PROFIT', s(params.aeroProfit || userInfo.AERO_PROFIT || '1'));
  form.append('APPLY_COMP_NM', s(params.applyCompNm || userInfo.APPLY_COMP_NM));
  form.append('APPLY_ZIP_CD', s(userInfo.APPLY_ZIP_CD));
  form.append('APPLY_ADDR', s(userInfo.APPLY_ADDR));
  form.append('APPLY_ADDR_DETAIL', s(userInfo.APPLY_ADDR_DETAIL));
  form.append('APPLY_ADDR_ID', '');

  // ═══════ 비행 일정 ═══════
  form.append('PLAN_START_YMD', s(params.startDate));
  form.append('PLAN_END_YMD', s(params.endDate));
  form.append('PLAN_START_YMD2', s(params.startDate2 || params.startDate));
  form.append('PLAN_END_YMD2', s(params.endDate2 || params.endDate));
  form.append('PLAN_PURPOSE', s(params.purpose || '03'));

  // ═══════ 비행 구역 (PLAN_LIST) ═══════
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const planGis = `${toDMS(c.lat, true)} ${toDMS(c.lon, false)}`;

    form.append(`PLAN_LIST[${i}].PLAN_PURPOSE_ETC`, s(params.purposeEtc || '시계비행'));
    if (i === 0) form.append('INPUT_PLAN_PURPOSE_ETC', s(params.inputPurposeEtc || ''));
    form.append(`PLAN_LIST[${i}].PLAN_DIRECT_PUR`, s(params.directPur || '01'));
    form.append(`PLAN_LIST[${i}].PLAN_PURPOSE_ETC_N`, s(params.purposeEtcN || '드론촬영'));
    form.append(`PLAN_LIST[${i}].PLAN_AERO_ETC`, s(params.aeroEtc || '취미'));
    if (i === 0) {
      form.append('PLAN_ADD_ETC', s(params.planAddEtc || ''));
      form.append('PLAN_CAMERA_DESC', s(params.cameraDesc || ''));
    }

    form.append(`PLAN_LIST[${i}].PLAN_ZIP_ADDR`, s(c.address));
    form.append(`PLAN_LIST[${i}].PLAN_ZIP_CD`, '');
    form.append(`PLAN_LIST[${i}].PLAN_ADDR`, s(c.address));
    form.append(`PLAN_LIST[${i}].PLAN_ADDR_ID`, s(c.addrId));
    form.append(`PLAN_LIST[${i}].PLAN_COORDINATES`, '');
    form.append(`PLAN_LIST[${i}].PLAN_GIS`, planGis);
    form.append(`PLAN_LIST[${i}].PLAN_GIS_X`, s(c.lon));
    form.append(`PLAN_LIST[${i}].PLAN_GIS_Y`, s(c.lat));
    form.append(`PLAN_LIST[${i}].PLAN_RADIUS`, s(c.radius || 500));
    form.append(`PLAN_LIST[${i}].PLAN_MEASURE_AREA`, '');
    form.append(`PLAN_LIST[${i}].PLAN_ALTITUDE_M`, s(params.altitude || '100'));
    form.append(`PLAN_LIST[${i}].PLAN_ALTITUDE_FT`, mToFt(params.altitude || 100));
    form.append(`PLAN_LIST[${i}].PLAN_LAYERTXT`, '');
    form.append(`PLAN_LIST[${i}].PLAN_LAYERID`, '');
    form.append(`PLAN_LIST[${i}].PLAN_AREA_TIP`, '');
  }

  // ═══════ 기체 정보 (AC_LIST[0]) ═══════
  const ac = aircraft;
  form.append('AC_LIST[0].AC_ID', s(ac.AC_ID));
  form.append('AC_LIST[0].AC_PROFIT', s(ac.AC_PROFIT || '2'));
  form.append('AC_LIST[0].AC_KIND', s(ac.AC_KIND || '13'));
  form.append('AC_LIST[0].AC_NM', s(ac.AC_NM));
  form.append('AC_LIST[0].AC_PRODUCER_NM', s(ac.AC_PRODUCER_NM));
  form.append('AC_LIST[0].AC_STANDARD', s(ac.AC_STANDARD));
  form.append('AC_LIST[0].AC_WEIGHT_TYPE', s(ac.AC_WEIGHT_TYPE || '8'));
  form.append('AC_LIST[0].AC_OWN_NM', s(ac.AC_OWN_NM || userInfo.APPLY_USER_NM));
  form.append('AC_LIST[0].AC_OWN_PHONE_NO', s(ac.AC_OWN_PHONE_NO || userInfo.APPLY_PHONE_NO));
  form.append('AC_LIST[0].AC_INSURANCE', s(ac.AC_INSURANCE || '0'));
  form.append('AC_LIST[0].AC_INSURANCE_DESC', s(ac.AC_INSURANCE_DESC));
  form.append('AC_LIST[0].AC_REG_NO', s(ac.AC_REG_NO));
  form.append('AC_LIST[0].AC_PRODUCT_NO', s(ac.AC_PRODUCT_NO));
  form.append('AC_LIST[0].AC_APPR_NO', s(ac.AC_APPR_NO));
  form.append('AC_LIST[0].AC_APPR_TYPE', s(ac.AC_APPR_TYPE));
  form.append('AC_LIST[0].AC_APPR_START_YMD', s(ac.AC_APPR_START_YMD));
  form.append('AC_LIST[0].AC_APPR_END_YMD', s(ac.AC_APPR_END_YMD));
  form.append('AC_LIST[0].AC_USE_TYPE', s(ac.AC_USE_TYPE || '2'));
  form.append('AC_LIST[0].AC_ACT_PICTURE', '');
  form.append('AC_LIST[0].AC_ACT_SPEC', '');
  form.append('AC_LIST[0].AC_ACT_REG', '');
  form.append('AC_LIST[0].AC_CAMERA_BLUEPRINT', s(params.acCameraBlueprint || ''));
  form.append('AC_LIST[0].AC_CAMERA_VIEWPOINT', s(params.acCameraViewpoint || ''));
  form.append('AC_LIST[0].AC_CAMERA_VIDEO', s(params.acCameraVideo || ''));
  form.append('AC_LIST[0].AC_CAMERA_PURPOSE_ETC', '');
  form.append('AC_LIST[0].AC_CAMERA_DESC', '');

  // ═══════ 기체 상위 레벨 중복 ═══════
  form.append('AC_ACT_PICTURE', '');
  form.append('AC_ACT_REG', '');
  form.append('AC_ACT_SPEC', '');
  form.append('AC_KIND', s(ac.AC_KIND || '13'));
  form.append('AC_REG_NO', s(ac.AC_REG_NO));
  form.append('AC_NM', s(ac.AC_NM));
  form.append('AC_PROFIT', s(ac.AC_PROFIT || '2'));
  form.append('AC_PRODUCER_NM', s(ac.AC_PRODUCER_NM));
  form.append('AC_USE_TYPE', s(ac.AC_USE_TYPE || '2'));
  form.append('AC_STANDARD', s(ac.AC_STANDARD));
  form.append('AC_WEIGHT_TYPE', s(ac.AC_WEIGHT_TYPE || '8'));
  form.append('AC_OWN_NM', s(ac.AC_OWN_NM || userInfo.APPLY_USER_NM));
  form.append('AC_OWN_PHONE_NO', s(ac.AC_OWN_PHONE_NO || userInfo.APPLY_PHONE_NO));
  form.append('AC_APPR_NO', s(ac.AC_APPR_NO));
  form.append('AC_APPR_TYPE', s(ac.AC_APPR_TYPE));
  form.append('AC_APPR_START_YMD', s(ac.AC_APPR_START_YMD));
  form.append('AC_APPR_END_YMD', s(ac.AC_APPR_END_YMD));
  form.append('AC_INSURANCE', s(ac.AC_INSURANCE || '0'));
  form.append('AC_INSURANCE_DESC', s(ac.AC_INSURANCE_DESC));
  form.append('AC_PRODUCT_NO', s(ac.AC_PRODUCT_NO));

  // ═══════ 조종자 정보 (PILOT_LIST[0]) ═══════
  const pilotBday = (userInfo.PILOT_BIRTHDAY_YMD || userInfo.APPLY_BIRTHDAY_YMD || '').replace(/-/g, '');
  form.append('PILOT_LIST[0].PILOT_NM', s(userInfo.PILOT_NM || userInfo.APPLY_USER_NM));
  form.append('PILOT_LIST[0].PILOT_BIRTHDAY_YMD', pilotBday);
  form.append('PILOT_LIST[0].PILOT_ZIP_CD', s(userInfo.PILOT_ZIP_CD || userInfo.APPLY_ZIP_CD));
  form.append('PILOT_LIST[0].PILOT_ADDR', s(userInfo.PILOT_ADDR || userInfo.APPLY_ADDR));
  form.append('PILOT_LIST[0].PILOT_ADDR_DETAIL', s(userInfo.PILOT_ADDR_DETAIL || userInfo.APPLY_ADDR_DETAIL));
  form.append('PILOT_LIST[0].PILOT_QUAL', s(userInfo.PILOT_QUAL));
  form.append('PILOT_LIST[0].PILOT_COMP_NM', s(params.pilotCompNm || ''));
  form.append('PILOT_LIST[0].PILOT_COMP_POSITON', s(params.pilotCompPositon || ''));
  form.append('PILOT_LIST[0].PILOT_HP', s(userInfo.PILOT_HP || userInfo.PILOT_TEL_NO || userInfo.APPLY_PHONE_NO));
  form.append('PILOT_LIST[0].PILOT_TEL_NO', s(userInfo.PILOT_TEL_NO || userInfo.APPLY_PHONE_NO));
  form.append('PILOT_LIST[0].AC_FLIGHT_ID', s(userInfo.AC_FLIGHT_ID || ''));
  form.append('PILOT_LIST[0].PILOT_ADD_SEQ', s(userInfo.PILOT_ADD_SEQ || '1'));

  // ═══════ 조종자 상위 레벨 중복 ═══════
  const pilotBdayDash = userInfo.PILOT_BIRTHDAY_YMD || userInfo.APPLY_BIRTHDAY_YMD || '';
  form.append('PILOT_NM', s(userInfo.PILOT_NM || userInfo.APPLY_USER_NM));
  form.append('PILOT_BIRTHDAY_YMD', pilotBdayDash);
  form.append('PILOT_COMP_NM', s(params.pilotCompNm || ''));
  form.append('PILOT_COMP_POSITON', s(params.pilotCompPositon || ''));
  form.append('PILOT_TEL_NO', s(userInfo.PILOT_TEL_NO || userInfo.APPLY_PHONE_NO));
  form.append('PILOT_ZIP_CD', s(userInfo.PILOT_ZIP_CD || userInfo.APPLY_ZIP_CD));
  form.append('PILOT_ADDR', s(userInfo.PILOT_ADDR || userInfo.APPLY_ADDR));
  form.append('PILOT_ADDR_DETAIL', s(userInfo.PILOT_ADDR_DETAIL || userInfo.APPLY_ADDR_DETAIL));
  form.append('PILOT_QUAL', s(userInfo.PILOT_QUAL));

  // ═══════ 첨부파일 공통 헬퍼 ═══════
  const att = attachments || {};
  const emptyFile = Buffer.alloc(0);
  const emptyFileOpts = { filename: '', contentType: 'application/octet-stream' };

  function appendFile(prefix, file) {
    form.append(prefix, '');
    form.append(prefix + '_NM', s(file?.name || ''));
    if (file?.buffer && file.buffer.length > 0) {
      form.append(prefix + '_MF', file.buffer, {
        filename: file.name,
        contentType: file.mimetype || 'application/octet-stream',
      });
    } else {
      form.append(prefix + '_MF', emptyFile, emptyFileOpts);
    }
  }

  // ═══════ 첨부파일 6종 ═══════
  appendFile('ACT_PICTURE', att.photo);
  appendFile('ACT_SPEC', att.spec);
  appendFile('ACT_REG', att.reg);
  appendFile('ACT_APPR', att.appr);
  appendFile('ACT_PILOT_NM', att.pilot);
  appendFile('ACT_INSURANCE', att.insurance);
  appendFile('ACT_BUSINESS', att.business);
  appendFile('ACT_TESTFLIGHT', att.testflight);
  appendFile('ACT_OPERATION_MANUAL', att.operationManual);
  appendFile('ACT_BUSINESS_P', att.businessP);

  // ═══════ 처리기관 (비행 + 촬영) ═══════
  form.append('PRO_USER', s(agency?.PRO_USER || ''));
  form.append('PRO_USERS', s(agency?.PRO_USERS || ''));
  form.append('PRO_USER2', s(agency?.PRO_USER2 || ''));
  form.append('PRO_USERS2', s(agency?.PRO_USERS2 || ''));

  // ═══════ 동의 ═══════
  form.append('AGREE_ALL_CHK', '1');
  form.append('AGREE_PO_CHK', '1');
  form.append('AGREE_PO_CHK_NM', '0');

  return form;
}

/**
 * registerF HTML에서 사용자 프로필 추출
 */
function parseUserProfile(html) {
  const extract = (name) => {
    // value="..." name="..." 또는 name="..." value="..." 패턴 모두 대응
    const r1 = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
    const r2 = new RegExp(`value="([^"]*)"[^>]*name="${name}"`, 'i');
    return (html.match(r1) || html.match(r2) || [])[1] || '';
  };

  return {
    APPLY_USER: extract('APPLY_USER'),
    APPLY_USER_NM: extract('APPLY_USER_NM'),
    APPLY_BIRTHDAY_YMD: extract('APPLY_BIRTHDAY_YMD'),
    APPLY_PHONE_NO: extract('APPLY_PHONE_NO'),
    APPLY_TEL_NO: extract('APPLY_TEL_NO'),
    APPLY_ZIP_CD: extract('APPLY_ZIP_CD'),
    APPLY_ADDR: extract('APPLY_ADDR'),
    APPLY_ADDR_DETAIL: extract('APPLY_ADDR_DETAIL'),
    APPLY_COMP_NM: extract('APPLY_COMP_NM'),
    AERO_PROFIT: extract('AERO_PROFIT') || '1',
    PILOT_NM: extract('PILOT_NM') || extract('APPLY_USER_NM'),
    PILOT_BIRTHDAY_YMD: extract('PILOT_BIRTHDAY_YMD') || extract('APPLY_BIRTHDAY_YMD'),
    PILOT_ZIP_CD: extract('PILOT_ZIP_CD') || extract('APPLY_ZIP_CD'),
    PILOT_ADDR: extract('PILOT_ADDR') || extract('APPLY_ADDR'),
    PILOT_ADDR_DETAIL: extract('PILOT_ADDR_DETAIL') || extract('APPLY_ADDR_DETAIL'),
    PILOT_QUAL: extract('PILOT_QUAL'),
    PILOT_TEL_NO: extract('PILOT_TEL_NO') || extract('APPLY_PHONE_NO'),
  };
}

module.exports = { buildRegisterForm, parseUserProfile, toDMS };
