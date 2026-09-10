import {dbHris, db, dbMaster, dbDMS } from "../../config/db.js";
import dayjs from "dayjs";
import * as dotenv from 'dotenv' ;
import { getWSA,getRandomDarkColor, decrypt, encrypt, getErrorResponse, objectToString } from "../../helpers/utils.js";
import { checkCollectionDetails, checkSubMenus, encryptCollectionDetailIds, encryptCollectionIds, encryptMenuIds, filterProductsByFullPipe, processSiteData } from "../../helpers/master/general.js";
import { logger } from "../../helpers/logger.js";
dotenv.config();

export const listSiteByDomain = async (req, res) => {
    // #swagger.tags = ['General']
  /* #swagger.security = [{
              "bearerAuth": []
      }] */
  // #swagger.description = 'Fungsi untuk menampilkan list site berdasarkan aplikasi per user'
    try {
      const { domain, param, empid } = req.query;
      const sites = await db.raw("SELECT site_code, site_desc FROM mst_site WITH (NOLOCK) WHERE site_domain = ? ORDER BY site_code", [domain]);
      if (param && sites.length > 0) return res.status(200).json(await processSiteData(sites, domain, await decrypt(empid)));
      return res.status(200).json(param ? [] : sites);
    } catch (error) {
      logger(error, 'GET /listSiteByDomain', req.query);
      return res.status(406).json(getErrorResponse(error));
    }
  }

 export const listParentMenu = async (req, res) => {
  // #swagger.tags = ['General']
  /* #swagger.security = [{
              "bearerAuth": []
      }] */
  // #swagger.description = 'Fungsi untuk menampilkan menu aplikasi'
  try {
    const { rowsPerPage, code, needle, descending, sortBy, page, filter } = req.query;
    
    // Base query builder
    const baseQuery = dbDMS("mst_menu")
      .whereNull('menu_parent')
      .whereNull('deleted_at');
    
    // Simple list without pagination
    if (!rowsPerPage) {
      const decryptedCode = code ? decrypt(code) : null;
      
      let query = baseQuery.select('menu_id', 'menu_name');
      
      if (decryptedCode) {
        query = query.where('menu_id', decryptedCode);
      }
      
      if (needle) {
        query = query.where('menu_name', 'like', `%${needle}%`);
      }
      
      const response = await query.orderBy("menu_name").limit(10);
      await encryptMenuIds(response);
      
      return res.status(200).json(response);
    }
    
    // Paginated list with optimizations
    const sorting = descending === 'true' ? 'desc' : 'asc';
    const columnSort = sortBy === 'asc' ? 'menu_order asc' : `${sortBy} ${sorting}`;
    const currentPage = Math.floor(page);
    const perPage = Math.floor(rowsPerPage);
    
    let query = baseQuery;
    
    // Apply filter if provided
    if (filter) {
      query = query.where((subQuery) => {
        subQuery
          .orWhere('menu_name', 'like', `%${filter}%`)
          .orWhere('menu_icon', 'like', `%${filter}%`)
          .orWhereRaw('CAST(menu_order AS varchar) like ?', `%${filter}%`);
      });
    }
    
    const response = await query
      .orderByRaw(columnSort)
      .paginate({
        perPage,
        currentPage,
        isLengthAware: true,
      });
    
    await encryptMenuIds(response.data);
    
    res.status(200).json(response);
    
  } catch (error) {
    return res.status(406).json(getErrorResponse(error));
  }
};

export const saveParent = async (req, res) => {
  // #swagger.tags = ['General']
  /* #swagger.security = [{
          "bearerAuth": []
  }] */
  // #swagger.description = 'Fungsi untuk simpan data parent'
  const trx = await dbDMS.transaction();
  try {
    const { name:menu_name, icon:menu_icon, order:menu_order, id: encryptedId, creator: encryptedCreator } = req.body;
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const id = encryptedId ? decrypt(encryptedId) : '0';
    const creator = decrypt(encryptedCreator);
    
    const menuData = {
      menu_name,
      menu_link: '#',
      menu_icon,
      menu_order,
      updated_by: creator,
      updated_at: now,
    };

    // Check if menu name already exists
    const existingMenu = await trx("mst_menu")
      .whereNull("menu_parent")
      .where("menu_name", menu_name)
      .where('menu_id', '<>', id)
      .first();
    console.log('ini id menu ',id)
    if (!existingMenu && id === '0') {
      // Insert new menu
      await trx("mst_menu").insert({
        ...menuData,
        created_by: creator,
        created_at: now,
      });
    } else if (!existingMenu) {
      // Update existing menu
      await trx("mst_menu")
        .where("menu_id", id)
        .update(menuData);
    } else {
      // Handle existing menu conflicts
      if (existingMenu.deleted_at === null && parseInt(existingMenu.id) !== parseInt(id)) {
        await trx.rollback();
        return res.status(406).json({
          type: 'error',
          message: `Menu sudah ada, silahkan Coba Lagi`,
        });
      } else if (existingMenu.deleted_at !== null) {
        // Restore deleted menu
        await trx("mst_menu")
          .where("menu_name", menu_name)
          .update({
            ...menuData,
            deleted_by: null,
            deleted_at: null,
          });
      }
    }
    await trx.commit();
    return res.json("sukses");
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /saveParent', req.body);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const deleteParent = async (req, res) => {
  // #swagger.tags = ['General']
 /* #swagger.security = [{
         "bearerAuth": []
 }] */
 // #swagger.description = 'Fungsi untuk hapus data menu parent'
 try {
    const { id: encryptedId, creator: encryptedCreator } = req.body;
    const id = encryptedId ? decrypt(encryptedId) : 0;
    const creator = decrypt(encryptedCreator);
    
    // Check if parent has sub menus
    const hasSubMenus = await checkSubMenus(id);
    
    if (hasSubMenus) {
      return res.status(406).json({
        type: 'error',
        message: `Tidak bisa dihapus karena punya sub menu`,
      });
    }
    
    // Delete the parent menu
    await dbDMS("mst_menu")
      .where("menu_id", id)
      .update({
        deleted_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        deleted_by: creator,
    });
   
    return res.json("success");
 } catch (error) {
   return res.status(406).json(getErrorResponse(error));
 }
};

export const listSubMenu = async (req, res) => {
  // #swagger.tags = ['General']
  /* #swagger.security = [{
              "bearerAuth": []
      }] */
  // #swagger.description = 'Fungsi untuk menampilkan sub menu aplikasi'
  try {

    const { rowsPerPage, descending, sortBy, page, filter, parent: encryptedParent } = req.query;
    
    // Simple list without pagination (currently empty - implement if needed)
    if (!rowsPerPage) {
      return res.status(200).json([]);
    }
    
    // Paginated list with optimizations
    const sorting = descending === 'true' ? 'desc' : 'asc';
    const columnSort = sortBy === 'asc' ? 'menu_order asc' : `${sortBy} ${sorting}`;
    const currentPage = Math.floor(page);
    const perPage = Math.floor(rowsPerPage);
    const parent = decrypt(encryptedParent);
    
    let query = dbDMS("mst_menu")
      .select("*", db.raw("(select menu_name from mst_menu where menu_id= ?) as parent_name", [parent]))
      .where('menu_parent', parent)
      .whereNull('deleted_at');
    
    // Apply filter if provided
    if (filter) {
      query = query.where((subQuery) => {
        subQuery
          .orWhere('menu_name', 'like', `%${filter}%`)
          .orWhere('menu_icon', 'like', `%${filter}%`)
          .orWhere('menu_link', 'like', `%${filter}%`)
          .orWhereRaw('CAST(menu_order AS varchar) like ?', `%${filter}%`);
      });
    }
    
    const response = await query
      .orderByRaw(columnSort)
      .paginate({
        perPage,
        currentPage,
        isLengthAware: true,
      });
    
    await encryptMenuIds(response.data);
    res.status(200).json(response);
  } catch (error) {
    return res.status(406).json(getErrorResponse(error));
  }
};

export const saveSubMenu = async (req, res) => {
  // #swagger.tags = ['General']
  /* #swagger.security = [{
          "bearerAuth": []
  }] */
  // #swagger.description = 'Fungsi untuk simpan data submenu'
  const trx = await dbDMS.transaction();
  try {
    const { name:menu_name, link:menu_link, icon:menu_icon, order:menu_order, id: encryptedId, dechiper, parent: encryptedParent, creator: encryptedCreator } = req.body;
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const id = encryptedId ? decrypt(encryptedId) : '0';
    const parent = dechiper ? decrypt(dechiper) : decrypt(encryptedParent);
    const creator = decrypt(encryptedCreator);
    
    const menuData = {
      menu_name,
      menu_link,
      menu_parent:parent,
      menu_icon,
      menu_order,
      updated_by: creator,
      updated_at: now,
    };
    
    // Check if link already exists for other sub menus
    const existingMenu = await trx("mst_menu")
      .whereNotNull("menu_parent")
      .where("menu_link", menu_link)
      .where('menu_id', '<>', id)
      .first();
    
    if (!existingMenu && id === '0') {
      // Insert new sub menu
      await trx("mst_menu").insert({
        ...menuData,
        created_by: creator,
        created_at: now,
      });
    } else if (!existingMenu) {
      // Update existing sub menu
      await trx("mst_menu")
        .where("menu_id", id)
        .update(menuData);
    } else {
      // Handle existing menu conflicts
      if (existingMenu.deleted_at === null && parseInt(existingMenu.id) !== parseInt(id)) {
        await trx.rollback();
        return res.status(406).json({
          type: 'error',
          message: `Link sudah ada, silahkan Coba Lagi`,
        });
      } else if (existingMenu.deleted_at !== null) {
        // Restore deleted menu
        await trx("mst_menu")
          .where("menu_link", menu_link)
          .update({
            ...menuData,
            deleted_by: null,
            deleted_at: null,
          });
      }
    }
    await trx.commit();
    return res.json("sukses");
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /saveSubMenu', req.body);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const deleteSubMenu = async (req, res) => {
  // #swagger.tags = ['General']
 /* #swagger.security = [{
         "bearerAuth": []
 }] */
 // #swagger.description = 'Fungsi untuk hapus data sub menu'
 try {
    const { id: encryptedId, creator: encryptedCreator } = req.body;
    const id = decrypt(encryptedId);
    const creator = decrypt(encryptedCreator);
    
    await dbDMS("mst_menu")
      .where("menu_id", id)
      .update({
        deleted_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        deleted_by: creator,
    });
   
    return res.json("success");
 } catch (error) {
   return res.status(406).json(getErrorResponse(error));
 }
};
  
export const listCollection = async (req, res) => {
  // #swagger.tags = ['General']
  /* #swagger.security = [{
              "bearerAuth": []
      }] */
  // #swagger.description = 'Fungsi untuk menampilkan menu aplikasi'
  try {
        const { rowsPerPage, descending, sortBy, page, filter } = req.query;
    
    // Simple list without pagination (currently empty - implement if needed)
    if (!rowsPerPage) {
      return res.status(200).json([]);
    }
    
    // Paginated list with optimizations
    const sorting = descending === 'true' ? 'desc' : 'asc';
    const columnSort = sortBy === 'asc' ? 'col_name asc' : `${sortBy} ${sorting}`;
    const currentPage = Math.floor(page);
    const perPage = Math.floor(rowsPerPage);
    
    let query = dbDMS("collection_menu as a")
      .select('a.*', 'b.menu_name')
      .innerJoin('mst_menu as b', function() {
        this.on('a.col_parent', '=', 'b.menu_id')
      })
      .whereNull('a.deleted_at');
    
    // Apply filter if provided
    if (filter) {
      query = query.where((subQuery) => {
        subQuery
          .orWhere('col_name', 'like', `%${filter}%`)
          .orWhere('col_icon', 'like', `%${filter}%`)
          .orWhere('col_link', 'like', `%${filter}%`)
          .orWhere('menu_name', 'like', `%${filter}%`)
          .orWhereRaw('CAST(col_order AS varchar) like ?', `%${filter}%`);
      });
    }
    
    const response = await query
      .orderByRaw(columnSort)
      .paginate({
        perPage,
        currentPage,
        isLengthAware: true,
      });
    
    await encryptCollectionIds(response.data);
    
    res.status(200).json(response);
   
  } catch (error) {
    return res.status(406).json(getErrorResponse(error));
  }
};

export const saveCollection = async (req, res) => {
  // #swagger.tags = ['General']
  /* #swagger.security = [{
          "bearerAuth": []
  }] */
  // #swagger.description = 'Fungsi untuk simpan data collection'
  const trx = await dbDMS.transaction();
  try {
    const { name, link, icon, order, id: encryptedId, parent: encryptedParent, creator: encryptedCreator } = req.body;
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const id = encryptedId ? decrypt(encryptedId) : '0';
    const parent = decrypt(encryptedParent);
    const creator = decrypt(encryptedCreator);
    
    const collectionData = {
      col_name: name,
      col_link: link,
      col_parent: parent,
      col_icon: icon,
      col_order: order,
      updated_by: creator,
      updated_at: now,
    };
    let action=null,dataString=null;
    // Check if link already exists for other collections
    const existingCollection = await trx("collection_menu")
      .where("col_link", link)
      .where('colid', '<>', id)
      .first();
    
    if (!existingCollection && id === '0') {
      // Insert new collection
      await trx("collection_menu").insert({...collectionData,created_by: creator,created_at: now});
      dataString=objectToString({...collectionData,created_by: creator,created_at: now});
      action = 'insert';
    } else if (!existingCollection) {
      // Update existing collection
      await trx("collection_menu")
        .where("colid", id)
        .update(collectionData);
      dataString=objectToString(collectionData);
      action = 'update';
    } else {
      // Handle existing collection conflicts
      if (existingCollection.deleted_at === null && parseInt(existingCollection.id) !== parseInt(id)) {
        await trx.rollback();
        return res.status(406).json({
          type: 'error',
          message: `Nama url sudah ada, silahkan Coba Lagi`,
        });
      } else if (existingCollection.deleted_at !== null) {
        // Restore deleted collection
        await trx("collection_menu")
          .where("col_link", link)
          .update({
            ...collectionData,
            deleted_by: null,
            deleted_at: null,
          });
      }
    }
    
    await trx.commit();
    return res.json("sukses");
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /saveCollection', req.body);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const deleteCollection = async (req, res) => {
  // #swagger.tags = ['General']
 /* #swagger.security = [{
         "bearerAuth": []
 }] */
 // #swagger.description = 'Fungsi untuk hapus data collection parent'
  try {
    const { id: encryptedId, creator: encryptedCreator } = req.body;
    const id = encryptedId ? decrypt(encryptedId) : '0';
    const creator = decrypt(encryptedCreator);
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    
    // Check if collection has sub details
    const hasDetails = await checkCollectionDetails(id);
    
    if (hasDetails) {
      return res.status(406).json({
        type: 'error',
        message: `Tidak bisa dihapus karena punya sub menu`,
      });
    }
    
    // Delete the collection
    await dbDMS("collection_menu")
      .where("colid", id)
      .update({
        deleted_by: creator,
        deleted_at: now
      });
    
    return res.json("success");
 } catch (error) {
   return res.status(406).json(getErrorResponse(error));
 }
};

export const listCollectionDetail = async (req, res) => {
  // #swagger.tags = ['General']
  /* #swagger.security = [{
              "bearerAuth": []
      }] */
  // #swagger.description = 'Fungsi untuk menampilkan collection detail'
  try {
    const { rowsPerPage, descending, sortBy, page, filter, parent: encryptedParent, code, needle } = req.query;
    const parent = decrypt(encryptedParent);
    
    // Simple list without pagination
    if (!rowsPerPage) {
      let query = dbDMS("mst_menu as a")
        .select('a.menu_id', 'a.menu_name', 'b.coldet_menu')
        .leftJoin('collection_det as b', function() {
          this.on('a.menu_id', '=', 'b.coldet_menu')
        })
        .where(function() {
          this.whereNull('b.coldet_menu')
            .orWhereNotNull('b.deleted_at')
        })
        .whereNull('a.deleted_at')
        .where('menu_parent', parent);
      
      if (code) {
        query = query.where('menu_id', code);
      }
      
      if (needle) {
        query = query.where('menu_name', 'like', `%${needle}%`);
      }
      
      const response = await query.orderBy("menu_name").limit(10);
      return res.status(200).json(response);
    }
    
    // Paginated list with optimizations
    const sorting = descending === 'true' ? 'desc' : 'asc';
    const columnSort = sortBy === 'asc' ? 'col_name asc' : `${sortBy} ${sorting}`;
    const currentPage = Math.floor(page);
    const perPage = Math.floor(rowsPerPage);
    
    let query = dbDMS("collection_det as a")
      .select('a.*', 'b.col_name', 'c.menu_name', 'c.menu_link', 'c.menu_parent')
      .innerJoin('collection_menu as b', function() {
        this.on('a.coldet_colid', '=', 'b.colid')
      })
      .innerJoin('mst_menu as c', function() {
        this.on('a.coldet_menu', '=', 'c.menu_id')
      })
      .where('coldet_colid', parent)
      .whereNull('a.deleted_at');
    
    // Apply filter if provided
    if (filter) {
      query = query.where((subQuery) => {
        subQuery
          .orWhere('col_name', 'like', `%${filter}%`)
          .orWhere('col_icon', 'like', `%${filter}%`)
          .orWhere('col_link', 'like', `%${filter}%`)
          //.orWhereRaw('CAST(menu_order AS varchar) like ?', `%${filter}%`);
      });
    }
    
    const response = await query
      .orderByRaw(columnSort)
      .paginate({
        perPage,
        currentPage,
        isLengthAware: true,
      });
    
    await encryptCollectionDetailIds(response.data);
    
    res.status(200).json(response);
   
  } catch (error) {
    return res.status(406).json(getErrorResponse(error));
  }
};

export const saveCollectionDetail = async (req, res) => {
  // #swagger.tags = ['General']
  /* #swagger.security = [{
          "bearerAuth": []
  }] */
  // #swagger.description = 'Fungsi untuk simpan data collection'
  const trx = await dbDMS.transaction();
  try {
    const { menu, id: encryptedId, creator: encryptedCreator } = req.body;
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const id = encryptedId ? decrypt(encryptedId) : '0';
    const creator = decrypt(encryptedCreator);
    
    const detailData = {
      coldet_colid: id,
      coldet_menu: menu,
      updated_by: creator,
      updated_at: now,
    };
    let action=null,dataString=null;
    // Check if menu already exists in collection details
    const existingDetail = await trx("collection_det")
      .where("coldet_menu", menu)
      .first();
    
    if (!existingDetail) {
      // Insert new collection detail
      await trx("collection_det").insert({...detailData,created_by: creator,created_at: now,});
      dataString=objectToString({...detailData,created_by: creator,created_at: now,});
      action = 'insert';
    } else {
      // Handle existing detail conflicts
      if (existingDetail.deleted_at === null && parseInt(existingDetail.coldet_colid) !== parseInt(id)) {
        await trx.rollback();
        return res.status(406).json({
          type: 'error',
          message: `Menu sudah di assign`,
        });
      } else if (existingDetail.deleted_at !== null) {
        // Restore deleted detail
        await trx("collection_det")
          .where("coldet_menu", menu)
          .update({...detailData,deleted_at: null,deleted_by: null,});
        dataString=objectToString({...detailData,deleted_at: null,deleted_by: null,});
        action = 'update';
      } else {
        // Update existing detail
        await trx("collection_det")
          .where("coldet_menu", menu)
          .update(detailData);
        dataString=objectToString(detailData);
        action = 'update';
      }
    }
    await trx.commit();
    return res.json("sukses");
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /saveCollectionDetail', req.body);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const deleteCollectionDetail = async (req, res) => {
  // #swagger.tags = ['General']
 /* #swagger.security = [{
         "bearerAuth": []
 }] */
 // #swagger.description = 'Fungsi untuk hapus data collection detail'
 try {
  const { menu, id: encryptedId, creator: encryptedCreator } = req.body;
  const id = encryptedId ? decrypt(encryptedId) : '0';
  const creator = decrypt(encryptedCreator);
  const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
  
  await dbDMS("collection_det")
    .where("coldet_colid", id)
    .where('coldet_menu', menu)
    .update({
      deleted_by: creator,
      deleted_at: now
    });
  
  return res.json("success");
 } catch (error) {
   return res.status(406).json(getErrorResponse(error));
 }
};

export const listCollectionMenu = async (req, res) => {
  // #swagger.tags = ['General']
  // #swagger.description = 'Menampilkan data collection'
  try {
    
    const { role: encryptedRole, data: dataEncrypt, empid: empidEncrypt, domain } = req.query;
    
    // console.log('=== DEBUG getCollectionMenu ===');
    // console.log('Raw dataEncrypt:', dataEncrypt);
    // console.log('Raw empidEncrypt:', empidEncrypt);
    // console.log('Domain:', domain);
    
    // Decrypt empid
    const empid = decrypt(empidEncrypt);
    // console.log('Decrypted empid:', empid);
    
    // Decode data from Base64 (URL-encoded Base64)
    // First decode URL encoding (%3D -> =), then decode Base64
    const dataDecoded = decodeURIComponent(dataEncrypt);
    // console.log('URL decoded data:', dataDecoded);
    
    const data = atob(dataDecoded);
    // console.log('Base64 decoded data:', data);
    
    // Get user's groups using master_user table
    const userGroups = await dbDMS('master_user')
      .select('account_type')
      .where({'emp_id': empid});
    
    // console.log('User groups:', userGroups);
      
    if (userGroups.length === 0) {
      // console.log('No user groups found, returning empty array');
      return res.status(200).json([]);
    }
    
    const groupIds = userGroups.map(g => g.account_type);
    // console.log('Group IDs:', groupIds);
    
    // Decode the collection link for query
    const collectionLink = data; // This should be something like '/collection/legal-master-data'
    // console.log('Collection link to query:', collectionLink);
    
    const dtMenu = await dbDMS("collection_det")
      .distinct('mst_menu.*')
      .innerJoin('collection_menu', 'coldet_colid', 'colid')
      .innerJoin('mst_menu', 'mst_menu.menu_id', 'coldet_menu')
      .innerJoin("menu_access", 'maccess_menuid', 'coldet_menu')
      .where("col_link", collectionLink)
      .where("maccess_view", 1)
      .whereIn("maccess_group_id", groupIds)
      .whereNull('mst_menu.deleted_at')
      .orderBy('menu_name', 'asc');
    
    // console.log('Menu items found:', dtMenu.length);
    
    // Add random color to each menu item
    dtMenu.forEach(item => {
      item.color = getRandomDarkColor();
    });
    
    // console.log('=== END DEBUG ===');
    
    return res.json(dtMenu);
      
  } catch (error) {
    console.error('Error in listCollectionMenu:', error);
    logger(error, 'GET /listCollectionMenu', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const listGrade = async (req, res) => {
  // #swagger.tags = ['General']
  // #swagger.description = 'Menampilkan data collection'
  try {
    const baseQuery = dbHris("master_grade_new");
    baseQuery.select('grade_name','grade_new')
    if(req.query.grade){
      baseQuery.where('grade_new','>=',req.query.grade)
    }
    const response = await baseQuery.orderBy('grade_new', 'asc');
    res.status(200).json(response);
  } catch (error) {
    logger(error, 'GET /listGrade', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};


