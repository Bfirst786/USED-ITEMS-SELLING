// A tiny stand-in for the eBay REST APIs the Apps Script calls, for UrlFetchApp fakes.
export function fakeEbay() {
  const st = { inventory: {}, offers: [], locations: [], images: 0, tokenCalls: [] };
  const json = (body, code = 200, headers) => ({ code, body, headers });
  const handler = (url, o) => {
    const u = new URL(url);
    const path = u.pathname;
    const method = (o.method || 'get').toLowerCase();
    if (path === '/identity/v1/oauth2/token') {
      st.tokenCalls.push(o.payload);
      if (o.headers.Authorization !== 'Basic ' + Buffer.from('APP:CERT').toString('base64')) return json({ error: 'invalid_client', error_description: 'client authentication failed' }, 401);
      if (o.payload.includes('grant_type=authorization_code')) return json({ access_token: 'AT1', expires_in: 7200, refresh_token: 'RT1' });
      return json({ access_token: 'AT2', expires_in: 7200 });
    }
    if (u.host === 'apim.ebay.com' && path.endsWith('create_image_from_file')) { st.images++; return json({}, 201, { Location: 'https://apim.ebay.com/commerce/media/v1_beta/image/img' + st.images }); }
    if (path.startsWith('/commerce/media/v1_beta/image/')) return json({ imageUrl: 'https://i.ebayimg.com/' + path.split('/').pop() + '.jpg' });
    if (!/^Bearer AT/.test(o.headers.Authorization)) return json({ errors: [{ message: 'Invalid access token' }] }, 401);
    if (path.includes('/fulfillment_policy')) return json({ fulfillmentPolicies: [{ fulfillmentPolicyId: 'F1', name: 'USPS Ground' }] });
    if (path.includes('/payment_policy')) return json({ paymentPolicies: [{ paymentPolicyId: 'P1', name: 'Managed payments' }] });
    if (path.includes('/return_policy')) return json({ returnPolicies: [{ returnPolicyId: 'R1', name: 'No returns' }] });
    if (path === '/sell/inventory/v1/location' && method === 'get') return st.locations.length ? json({ locations: st.locations }) : json({}, 404);
    if (path.startsWith('/sell/inventory/v1/location/') && method === 'post') { st.locations.push({ merchantLocationKey: path.split('/').pop(), ...JSON.parse(o.payload) }); return json('', 204); }
    if (path.startsWith('/sell/inventory/v1/inventory_item/')) { st.inventory[decodeURIComponent(path.split('/').pop())] = JSON.parse(o.payload); return json('', 204); }
    if (path === '/sell/inventory/v1/offer' && method === 'get') {
      const offers = st.offers.filter((x) => x.sku === u.searchParams.get('sku'));
      return offers.length ? json({ offers }) : json({ errors: [{ errorId: 25713, message: 'This Offer is not available.' }] }, 404);
    }
    if (path === '/sell/inventory/v1/offer' && method === 'post') {
      const off = JSON.parse(o.payload);
      if (!off.categoryId) return json({ errors: [{ errorId: 25005, message: 'The category ID is invalid.', parameters: [{ name: 'categoryId', value: '' }] }] }, 400);
      const offer = { ...off, offerId: 'O' + (st.offers.length + 1), status: 'UNPUBLISHED' };
      st.offers.push(offer);
      return json({ offerId: offer.offerId }, 201);
    }
    let m = path.match(/^\/sell\/inventory\/v1\/offer\/(\w+)\/publish$/);
    if (m) { const off = st.offers.find((x) => x.offerId === m[1]); off.status = 'PUBLISHED'; off.listing = { listingId: '1234567890' }; return json({ listingId: '1234567890' }); }
    m = path.match(/^\/sell\/inventory\/v1\/offer\/(\w+)$/);
    if (m && method === 'put') { const off = st.offers.find((x) => x.offerId === m[1]); Object.assign(off, JSON.parse(o.payload)); return json('', 204); }
    if (path.includes('get_category_suggestions')) return json({ categorySuggestions: [{ category: { categoryId: '112529', categoryName: 'Headphones' }, categoryTreeNodeAncestors: [{ categoryName: 'Portable Audio & Headphones' }, { categoryName: 'Consumer Electronics' }] }] });
    if (path.includes('get_item_aspects_for_category')) return json({ aspects: [{ localizedAspectName: 'Brand', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' } }, { localizedAspectName: 'Color', aspectConstraint: { aspectRequired: false } }] });
    return json({ errors: [{ message: 'not mocked: ' + method + ' ' + path }] }, 500);
  };
  return { st, handler };
}
